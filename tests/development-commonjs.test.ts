import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('the development server serves the shared cutter catalog as browser-compatible named exports', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const server = await createServer({
    root,
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const result = await server.transformRequest('/electron/cutters/catalog.cjs');
    assert.ok(result, 'the development server did not transform the catalog');
    // Import the actual served module without Node's CommonJS file loader.
    const catalog = await import(
      `data:text/javascript;base64,${Buffer.from(result.code).toString('base64')}`
    );
    assert.equal(catalog.getMachine('explore-5').name, 'Explore 5');
    assert.equal(catalog.isMachine('maker-5'), true);
    assert.equal(catalog.generatedSheetIssue('explore-5', 'letter'), '');
    assert.ok(catalog.MACHINES.length > 1);
  } finally {
    await server.close();
  }
});
