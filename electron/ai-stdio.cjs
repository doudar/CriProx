// A design-only stdio relay. The GUI must explicitly enable its local server.
// Never loads the desktop main process, printer service or cutter controller.
const fs = require('node:fs/promises');
function validateConnection(value) {
  const url = new URL(value?.url);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.pathname !== '/mcp' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^[a-f0-9]{64}$/.test(value?.token)
  )
    throw Error('Invalid local CriProx connection.');
  return value;
}
async function relay({
  connectionFile,
  input = process.stdin,
  output = process.stdout,
  fetchImpl = fetch,
}) {
  if (!connectionFile) throw Error('Provide --connection-file from CriProx Settings → AI design.');
  const connection = validateConnection(JSON.parse(await fs.readFile(connectionFile, 'utf8')));
  input.setEncoding('utf8');
  let buffer = '',
    version = '2025-11-25';
  const send = (value) => output.write(JSON.stringify(value) + '\n');
  for await (const chunk of input) {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 64_000_000) throw Error('MCP message too large.');
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
        if (message.method === 'initialize' && typeof message.params?.protocolVersion === 'string')
          version = message.params.protocolVersion;
        const response = await fetchImpl(connection.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${connection.token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': version,
          },
          body: line,
          redirect: 'error',
          signal: AbortSignal.timeout(45000),
        });
        const text = await response.text();
        if (text) {
          const result = JSON.parse(text);
          if (result.result?.protocolVersion) version = result.result.protocolVersion;
          if (message.id !== undefined)
            send(
              result.jsonrpc
                ? result
                : {
                    jsonrpc: '2.0',
                    id: message.id,
                    error: {
                      code: -32000,
                      message:
                        'The local design server rejected the request. Restart AI design access in CriProx.',
                    },
                  },
            );
        }
      } catch (error) {
        if (message?.id !== undefined)
          send({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32000,
              message:
                error.message === 'fetch failed'
                  ? 'Open CriProx and start AI design access in Settings.'
                  : error.message,
            },
          });
      }
    }
  }
}
async function start() {
  const i = process.argv.indexOf('--connection-file');
  await relay({ connectionFile: i >= 0 ? process.argv[i + 1] : undefined });
}
module.exports = { relay, start, validateConnection };
if (require.main === module)
  start().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
