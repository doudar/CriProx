import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBase } from './lib.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '_site');
const base = normalizeBase(process.env.SITE_BASE_PATH ?? '/Skarix/');
const port = Number(process.env.PORT || 4174);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};
// Serve an immutable snapshot. Request paths never reach the filesystem,
// symlinks are ignored, and a rebuild cannot race a request's file reads.
const files = new Map();
async function load(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await load(path.join(directory, entry.name), relative + '/');
    else if (entry.isFile() && types[path.extname(entry.name)]) {
      files.set(base + relative, {
        body: await readFile(path.join(directory, entry.name)),
        type: types[path.extname(entry.name)],
      });
    }
  }
}
await load(root);
createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400);
    response.end('Invalid URL');
    return;
  }
  if (pathname === '/' && base !== '/') {
    response.writeHead(302, { Location: base });
    response.end();
    return;
  }
  if (!pathname.endsWith('/') && files.has(pathname + '/index.html')) {
    response.writeHead(302, { Location: pathname + '/' });
    response.end();
    return;
  }
  const file = files.get(pathname.endsWith('/') ? pathname + 'index.html' : pathname);
  if (file) {
    response.writeHead(200, { 'Content-Type': file.type });
    response.end(file.body);
  } else {
    response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(files.get(base + '404.html')?.body || 'Page not found.');
  }
}).listen(port, '127.0.0.1', () => console.log(`Skarix website: http://127.0.0.1:${port}${base}`));
