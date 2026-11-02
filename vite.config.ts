import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { buildSync } from 'esbuild';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { bundledReleaseHistory, mergeReleaseHistory } = createRequire(import.meta.url)(
  './electron/release-history.cjs',
);

const packageVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'shared-commonjs-development',
      apply: 'serve',
      transform(_code, id) {
        if (
          !/\/electron\/(?:ai-tools|design-appearance|cutter\/(?:materials|geometry)|cutters\/catalog)\.cjs$/.test(
            id.replaceAll('\\\\', '/'),
          )
        )
          return;
        const names = Object.keys(createRequire(import.meta.url)(id));
        const source =
          'import shared from ' +
          JSON.stringify(id) +
          ';' +
          names.map((name) => 'export const ' + name + ' = shared.' + name + ';').join('');
        return {
          code: buildSync({
            stdin: { contents: source, resolveDir: path.dirname(id) },
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
          }).outputFiles[0].text,
          map: null,
        };
      },
    },
  ],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
    __APP_CHANGELOG__: JSON.stringify(
      mergeReleaseHistory(packageVersion, bundledReleaseHistory(packageVersion)),
    ),
  },
  server: {
    proxy: {
      '/mpc-api': {
        target: 'https://mpcfill.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mpc-api/, ''),
      },
      '/deck-source-api/moxfield': {
        target: 'https://api2.moxfield.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/deck-source-api\/moxfield/, '/v3/decks/all'),
      },
      '/deck-source-api/archidekt': {
        target: 'https://archidekt.com',
        changeOrigin: true,
        rewrite: (path) => `${path.replace(/^\/deck-source-api\/archidekt/, '/api/decks')}/`,
      },
    },
  },
});
