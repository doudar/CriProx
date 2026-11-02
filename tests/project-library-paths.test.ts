import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { projectLibraryPaths } = require('../electron/project-library-paths.cjs') as {
  projectLibraryPaths: (paths: { userData: string; documents: string }) => {
    defaultRoot: string;
    legacyRoot: string;
    settingsFile: string;
    legacyImportMarker: string;
  };
};

test('the default project library stays inside app data instead of Documents', () => {
  const paths = projectLibraryPaths({
    userData: '/Users/example/Library/Application Support/Skarix',
    documents: '/Users/example/Documents',
  });

  assert.equal(
    paths.defaultRoot,
    path.join('/Users/example/Library/Application Support/Skarix', 'projects'),
  );
  assert.equal(paths.legacyRoot, path.join('/Users/example/Documents', 'CriProx'));
  assert.equal(path.dirname(paths.settingsFile), path.dirname(paths.defaultRoot));
  assert.equal(path.dirname(paths.legacyImportMarker), path.dirname(paths.defaultRoot));
  assert.notEqual(paths.defaultRoot, paths.legacyRoot);
});

test('project library base folders must be absolute', () => {
  assert.throws(() =>
    projectLibraryPaths({ userData: 'relative/app-data', documents: '/Users/example/Documents' }),
  );
  assert.throws(() =>
    projectLibraryPaths({
      userData: '/Users/example/Library/Application Support/Skarix',
      documents: 'relative/documents',
    }),
  );
});
