const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { McpServer } = require('@modelcontextprotocol/server');
const { NodeStreamableHTTPServerTransport } = require('@modelcontextprotocol/node');
const { DESIGN_TOOLS, designTool } = require('./ai-tools.cjs');
const MAX_BODY = 64_000_000;
function mcpServer(invoke, version = '1.0.0') {
  const server = new McpServer(
    { name: 'criprox-design', version },
    {
      instructions:
        'Create editable proxy cards and sticker illustrations in the live Skarix editor. Read get_design_capabilities first. All distances are millimeters. Printing and cutter control are human-only and are not exposed.',
      maxToolInputElements: 500000,
      supportedProtocolVersions: ['2025-11-25', '2025-06-18', '2025-03-26'],
    },
  );
  for (const tool of DESIGN_TOOLS)
    server.registerTool(
      tool.name,
      {
        title: tool.name.replaceAll('_', ' '),
        description: tool.description,
        inputSchema: tool.schema,
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: !tool.readOnly,
          openWorldHint: ['search_cards', 'add_catalog_cards'].includes(tool.name),
        },
      },
      async (args) => {
        try {
          const value = await invoke(tool.name, designTool(tool.name).schema.parse(args));
          if (value?.image) {
            const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
              value.image,
            );
            if (!match) throw Error('Invalid preview image.');
            return { content: [{ type: 'image', mimeType: `image/${match[1]}`, data: match[2] }] };
          }
          return {
            content: [{ type: 'text', text: JSON.stringify(value) }],
            structuredContent: value && typeof value === 'object' ? value : { value },
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: error instanceof Error ? error.message : 'The design operation failed.',
              },
            ],
            isError: true,
          };
        }
      },
    );
  return server;
}
function createAiServer({ invoke, version, connectionFile }) {
  let listener,
    token = '',
    url = '',
    owner,
    starting = false,
    stopping,
    active = 0,
    generation = 0;
  const pending = new Set();
  const status = () => ({
    running: !!listener,
    url,
    connectionFile: connectionFile || '',
    scope: 'design-only',
  });
  function stop() {
    // Window closure and before-quit can arrive together. Every caller must
    // await the same socket closure and connection-file removal before exit.
    if (!stopping)
      stopping = finishStop().finally(() => {
        stopping = undefined;
      });
    return stopping;
  }
  async function finishStop() {
    generation++;
    const old = listener;
    const record = JSON.stringify({ url, token });
    listener = undefined;
    token = '';
    url = '';
    owner = undefined;
    for (const item of pending) void item.close().catch(() => {});
    pending.clear();
    if (old) {
      old.closeAllConnections();
      await new Promise((resolve) => old.close(resolve));
    }
    if (connectionFile) {
      try {
        if ((await fs.readFile(connectionFile, 'utf8')) === record)
          await fs.rm(connectionFile, { force: true });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return status();
  }
  async function start(windowId) {
    if (stopping) await stopping;
    if (starting) throw Error('The AI design server is starting.');
    if (listener) {
      if (windowId !== owner) throw Error('The AI server belongs to another Skarix window.');
      return status();
    }
    starting = true;
    try {
      token = crypto.randomBytes(32).toString('hex');
      owner = windowId;
      const epoch = ++generation;
      listener = http.createServer(async (req, res) => {
        const deny = (code, message) => {
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: message }));
        };
        if (!url || !listener) return deny(503, 'AI design access is not active.');
        const expected = Buffer.from(`Bearer ${token}`),
          actual = Buffer.from(String(req.headers.authorization || ''));
        if (
          req.headers.origin ||
          req.headers.host !== new URL(url).host ||
          actual.length !== expected.length ||
          !crypto.timingSafeEqual(actual, expected)
        )
          return deny(403, 'Local design authorization required.');
        if (req.url !== '/mcp') return deny(404, 'Not found.');
        if (req.method !== 'POST') return deny(405, 'Use MCP POST requests.');
        if (active >= 8) return deny(429, 'Too many design requests.');
        active++;
        let server;
        try {
          if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))
            return deny(415, 'Use application/json.');
          let size = 0,
            chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_BODY) return deny(413, 'Design request exceeds 64 MB.');
            chunks.push(chunk);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          server = mcpServer(async (name, args) => {
            if (epoch !== generation || !listener) throw Error('AI design access has stopped.');
            return invoke(owner, name, args);
          }, version);
          pending.add(server);
          const transport = new NodeStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          });
          await server.connect(transport);
          await transport.handleRequest(req, res, body);
        } catch {
          if (!res.headersSent) deny(400, 'Invalid design protocol request.');
          else if (!res.writableEnded) res.end();
        } finally {
          active--;
          if (server) {
            pending.delete(server);
            await server.close().catch(() => {});
          }
        }
      });
      listener.requestTimeout = 45000;
      listener.headersTimeout = 10000;
      await new Promise((resolve, reject) => {
        listener.once('error', reject);
        listener.listen(0, '127.0.0.1', resolve);
      });
      url = `http://127.0.0.1:${listener.address().port}/mcp`;
      if (connectionFile) {
        await fs.mkdir(path.dirname(connectionFile), { recursive: true });
        try {
          const existing = await fs.readFile(connectionFile, 'utf8');
          const prior = require('./ai-stdio.cjs').validateConnection(JSON.parse(existing));
          let response;
          try {
            response = await fetch(prior.url, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${prior.token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                'MCP-Protocol-Version': '2025-11-25',
              },
              body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' }),
              redirect: 'error',
              signal: AbortSignal.timeout(1500),
            });
          } catch {}
          if (response?.ok)
            throw Error('Another Skarix window has AI design access on. Stop access there first.');
          if ((await fs.readFile(connectionFile, 'utf8')) === existing) await fs.rm(connectionFile);
        } catch (error) {
          if (
            error.message?.startsWith('Another Skarix') ||
            (error.code && error.code !== 'ENOENT')
          )
            throw error;
        }
        await fs.writeFile(connectionFile, JSON.stringify({ url, token }), {
          mode: 0o600,
          flag: 'wx',
        });
      }
      return status();
    } catch (error) {
      await stop();
      throw error;
    } finally {
      starting = false;
    }
  }
  function configuration(executable, relayPath) {
    if (!listener) throw Error('Start AI design access first.');
    return {
      mcpServers: {
        criprox: {
          command: executable,
          args: [relayPath, '--connection-file', connectionFile],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        },
      },
    };
  }
  return { start, stop, status, configuration, owns: (id) => owner === id };
}
module.exports = { createAiServer, mcpServer, MAX_BODY };
