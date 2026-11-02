import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { DEFAULT_SETTINGS } from '../src/lib/types';

const require = createRequire(import.meta.url);
const {
  PROJECT_FILE,
  abortProjectSave,
  assertProjectId,
  beginProjectSave,
  createFolder,
  deleteFolder,
  listLibrary,
  moveProject,
  deleteProject,
  finishProjectSave,
  importProjects,
  listProjects,
  openProject,
  openProjectManifest,
  projectDirectoryName,
  readProjectAsset,
  saveProject,
  saveProjectAsset,
} = require('../electron/project-library.cjs') as {
  PROJECT_FILE: string;
  createFolder: (root: string, parent: string, name: string) => Promise<string>;
  deleteFolder: (root: string, folder: string) => Promise<void>;
  listLibrary: (root: string) => Promise<{
    projects: ProjectSummary[];
    folders: { id: string; name: string; parent: string; empty: boolean }[];
  }>;
  moveProject: (root: string, projectId: string, folder: string) => Promise<ProjectSummary>;
  abortProjectSave: (session: ProjectSaveSession) => Promise<void>;
  assertProjectId: (value: unknown) => string;
  beginProjectSave: (
    root: string,
    request: { projectId: string | null; name: string; folder?: string },
  ) => Promise<ProjectSaveSession>;
  deleteProject: (
    root: string,
    projectId: string,
    moveToTrash: (directory: string) => Promise<void>,
  ) => Promise<void>;
  finishProjectSave: (session: ProjectSaveSession, data: string) => Promise<ProjectSummary>;
  importProjects: (sourceRoot: string, destinationRoot: string) => Promise<ProjectSummary[]>;
  listProjects: (root: string) => Promise<ProjectSummary[]>;
  openProject: (root: string, projectId: string) => Promise<unknown>;
  openProjectManifest: (root: string, projectId: string) => Promise<unknown>;
  projectDirectoryName: (name: string) => string;
  readProjectAsset: (root: string, projectId: string, relativePath: string) => Promise<string>;
  saveProject: (
    root: string,
    request: { projectId: string | null; data: string; folder?: string },
  ) => Promise<ProjectSummary>;
  saveProjectAsset: (session: ProjectSaveSession, dataUrl: string) => Promise<string>;
};

type ProjectSaveSession = {
  projectId: string;
  directory: string;
  isNew: boolean;
  complete: boolean;
  assets: Set<string>;
};

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRfoAAAAASUVORK5CYII=';
const project = {
  version: 1 as const,
  name: 'My Commander: Deck / 2026',
  settings: DEFAULT_SETTINGS,
  entries: [
    {
      id: 'entry-1',
      quantity: 2,
      face: 0,
      card: {
        id: 'card-1',
        name: 'Local card',
        set: 'local',
        setName: 'Your artwork',
        collector: '',
        faces: [{ name: 'Local card', image: tinyPng, preview: tinyPng }],
      },
    },
  ],
};

test('project folder names and identifiers are portable and path-safe', () => {
  assert.equal(projectDirectoryName(project.name), 'my-commander-deck-2026');
  assert.equal(projectDirectoryName('Crème brûlée'), 'creme-brulee');
  assert.equal(projectDirectoryName('...'), 'untitled-project');
  assert.equal(assertProjectId('safe-project-2'), 'safe-project-2');
  for (const unsafe of [
    '../escape',
    '/absolute',
    'two words',
    '',
    'UPPER',
    'a//deck',
    'a/../deck',
    'a/./deck',
    'a\\deck',
    'a/deck/',
  ])
    assert.throws(() => assertProjectId(unsafe));
});

test('managed projects save custom artwork as assets and hydrate it when opened', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'skarix-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const first = await saveProject(root, { projectId: null, data: JSON.stringify(project) });
  assert.equal(first.id, 'my-commander-deck-2026');
  assert.equal(first.cardCount, 2);

  const projectFile = path.join(root, first.id, PROJECT_FILE);
  const stored = JSON.parse(await fs.readFile(projectFile, 'utf8'));
  const storedImage = stored.entries[0].card.faces[0].image as string;
  assert.match(storedImage, /^assets\/[a-f0-9]{24}\.png$/);
  assert.equal(stored.entries[0].card.faces[0].preview, storedImage);
  assert.deepEqual(await fs.readdir(path.join(root, first.id, 'assets')), [
    path.basename(storedImage),
  ]);

  const opened = (await openProject(root, first.id)) as typeof project;
  assert.equal(opened.entries[0].card.faces[0].image, tinyPng);
  assert.equal(opened.entries[0].card.faces[0].preview, tinyPng);

  const renamed = { ...project, name: 'Renamed deck' };
  await saveProject(root, { projectId: first.id, data: JSON.stringify(renamed) });
  const projects = await listProjects(root);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].id, first.id);
  assert.equal(projects[0].name, 'Renamed deck');

  await fs.writeFile(path.join(root, first.id, storedImage), 'corrupted');
  await assert.rejects(
    saveProject(root, { projectId: first.id, data: JSON.stringify(project) }),
    /corrupted/,
  );
});

test('incremental project saves externalize assets before committing the manifest', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'skarix-incremental-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const session = await beginProjectSave(root, { projectId: null, name: project.name });
  const relativePath = await saveProjectAsset(session, tinyPng);
  const stored = JSON.parse(JSON.stringify(project));
  stored.entries[0].card.faces[0].image = relativePath;
  stored.entries[0].card.faces[0].preview = relativePath;
  const saved = await finishProjectSave(session, JSON.stringify(stored));

  assert.equal(saved.id, 'my-commander-deck-2026');
  assert.equal(
    ((await openProjectManifest(root, saved.id)) as typeof stored).entries[0].card.faces[0].image,
    relativePath,
  );
  assert.equal(await readProjectAsset(root, saved.id, relativePath), tinyPng);
});

test('aborting a new incremental save removes its incomplete project folder', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'skarix-aborted-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const session = await beginProjectSave(root, { projectId: null, name: project.name });
  await saveProjectAsset(session, tinyPng);
  await abortProjectSave(session);

  assert.deepEqual(await fs.readdir(root), []);
});

test('managed projects allocate a non-destructive suffix for duplicate names', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'skarix-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const first = await saveProject(root, { projectId: null, data: JSON.stringify(project) });
  const second = await saveProject(root, { projectId: null, data: JSON.stringify(project) });
  assert.equal(first.id, 'my-commander-deck-2026');
  assert.equal(second.id, 'my-commander-deck-2026-2');
});

test('legacy project import copies hydrated projects and keeps the originals', async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(tmpdir(), 'skarix-documents-library-'));
  const destinationRoot = await fs.mkdtemp(path.join(tmpdir(), 'skarix-app-library-'));
  t.after(() =>
    Promise.all([
      fs.rm(sourceRoot, { recursive: true, force: true }),
      fs.rm(destinationRoot, { recursive: true, force: true }),
    ]),
  );

  const source = await saveProject(sourceRoot, {
    projectId: null,
    data: JSON.stringify(project),
  });
  const imported = await importProjects(sourceRoot, destinationRoot);

  assert.equal(imported.length, 1);
  assert.equal(imported[0].name, project.name);
  assert.equal((await listProjects(sourceRoot)).length, 1);
  const opened = (await openProject(destinationRoot, imported[0].id)) as typeof project;
  assert.equal(opened.entries[0].card.faces[0].image, tinyPng);
  assert.equal(source.id, imported[0].id);
});

test(
  'managed project reads reject symlinked project and artwork files',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'skarix-library-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const saved = await saveProject(root, { projectId: null, data: JSON.stringify(project) });
    const directory = path.join(root, saved.id);
    const projectFile = path.join(directory, PROJECT_FILE);
    const stored = JSON.parse(await fs.readFile(projectFile, 'utf8'));
    const artworkFile = path.join(directory, stored.entries[0].card.faces[0].image);
    const realArtworkFile = `${artworkFile}.real`;

    await fs.rename(artworkFile, realArtworkFile);
    await fs.symlink(path.basename(realArtworkFile), artworkFile);
    await assert.rejects(openProject(root, saved.id), /Managed artwork is invalid/);
    await fs.unlink(artworkFile);
    await fs.rename(realArtworkFile, artworkFile);

    const realProjectFile = `${projectFile}.real`;
    await fs.rename(projectFile, realProjectFile);
    await fs.symlink(path.basename(realProjectFile), projectFile);
    await assert.rejects(openProject(root, saved.id), /Project data is invalid/);
  },
);

test('project deletion delegates the validated project folder to a recoverable trash action', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'skarix-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'unrelated-folder'));
  let unrelatedWasDeleted = false;
  await assert.rejects(
    deleteProject(root, 'unrelated-folder', async () => {
      unrelatedWasDeleted = true;
    }),
  );
  assert.equal(unrelatedWasDeleted, false);

  const saved = await saveProject(root, { projectId: null, data: JSON.stringify(project) });
  const expectedDirectory = path.join(root, saved.id);
  let deletedDirectory = '';

  await deleteProject(root, saved.id, async (directory) => {
    deletedDirectory = directory;
    await fs.rename(directory, `${directory}.trashed`);
  });

  assert.equal(deletedDirectory, expectedDirectory);
  assert.deepEqual(await listProjects(root), []);
});

test('nested library folders save, discover, move, reopen and delete projects with artwork', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'skarix-folders-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await createFolder(root, '', 'Commander');
  const folder = await createFolder(root, 'Commander', 'Budget decks');
  const saved = await saveProject(root, { projectId: null, folder, data: JSON.stringify(project) });
  assert.equal(saved.id, 'Commander/Budget decks/my-commander-deck-2026');
  assert.equal(assertProjectId(saved.id), saved.id);
  const library = await listLibrary(root);
  assert.deepEqual(
    library.folders.map((item) => item.id),
    ['Commander', 'Commander/Budget decks'],
  );
  assert.equal(library.projects[0].id, saved.id);
  assert.equal(
    ((await openProject(root, saved.id)) as typeof project).entries[0].card.faces[0].image,
    tinyPng,
  );
  // Existing IDs determine where subsequent saves go, regardless of the browsing folder.
  await saveProject(root, { projectId: saved.id, folder: '', data: JSON.stringify(project) });
  const existing = await saveProject(root, { projectId: null, data: JSON.stringify(project) });
  const moved = await moveProject(root, saved.id, '');
  assert.equal(moved.id, `${existing.id}-2`);
  assert.equal(
    moved.updatedAt,
    (await listProjects(root)).find((item) => item.id === moved.id)?.updatedAt,
  );
  await assert.rejects(openProject(root, saved.id));
  assert.equal(
    ((await openProject(root, moved.id)) as typeof project).entries[0].card.faces[0].image,
    tinyPng,
  );
  assert.equal((await listProjects(root)).length, 2);
  await deleteProject(root, moved.id, async (directory) => fs.rm(directory, { recursive: true }));
  assert.equal((await listProjects(root)).length, 1);
});

test('empty library folders can be deleted, one level at a time, while the root is protected', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'skarix-empty-folders-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await createFolder(root, '', 'Commander');
  await createFolder(root, 'Commander', 'Budget decks');
  assert.deepEqual((await listLibrary(root)).folders, [
    { id: 'Commander', name: 'Commander', parent: '', empty: false },
    { id: 'Commander/Budget decks', name: 'Budget decks', parent: 'Commander', empty: true },
  ]);
  await assert.rejects(deleteFolder(root, ''), /library itself cannot be deleted/);
  await assert.rejects(deleteFolder(root, 'Commander'), /Only empty folders/);
  await deleteFolder(root, 'Commander/Budget decks');
  assert.equal((await listLibrary(root)).folders[0].empty, true);
  await deleteFolder(root, 'Commander');
  assert.deepEqual(await fs.readdir(root), []);
  assert.deepEqual((await listLibrary(root)).folders, []);
});

test('folder deletion preserves projects, hidden files and contents added after a refresh', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'skarix-folder-contents-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await createFolder(root, '', 'Hidden files');
  await fs.writeFile(path.join(root, 'Hidden files', '.keep'), 'keep me');
  await createFolder(root, '', 'Decks');
  const saved = await saveProject(root, {
    projectId: null,
    folder: 'Decks',
    data: JSON.stringify(project),
  });
  await createFolder(root, '', 'Initially empty');
  const snapshot = await listLibrary(root);
  assert.equal(snapshot.folders.find((item) => item.id === 'Hidden files')?.empty, false);
  assert.equal(snapshot.folders.find((item) => item.id === 'Decks')?.empty, false);
  assert.equal(snapshot.folders.find((item) => item.id === 'Initially empty')?.empty, true);
  await fs.writeFile(path.join(root, 'Initially empty', 'added.txt'), 'new contents');
  for (const folder of ['Hidden files', 'Decks', 'Initially empty'])
    await assert.rejects(deleteFolder(root, folder), /Only empty folders/);
  await assert.rejects(deleteFolder(root, saved.id), /saved project/);
  await assert.rejects(deleteFolder(root, `${saved.id}/assets`), /saved project/);
  for (const folder of ['../outside', '/absolute', '.', 'Decks/../Hidden files'])
    await assert.rejects(deleteFolder(root, folder));
  assert.equal(await fs.readFile(path.join(root, 'Hidden files', '.keep'), 'utf8'), 'keep me');
  assert.equal(
    await fs.readFile(path.join(root, 'Initially empty', 'added.txt'), 'utf8'),
    'new contents',
  );
  assert.equal(
    ((await openProject(root, saved.id)) as typeof project).entries[0].card.faces[0].image,
    tinyPng,
  );
});

test('folder validation rejects traversal, project interiors, excessive depth and duplicate names', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'skarix-folder-validation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of [
    '../escape',
    '/absolute',
    'a/b',
    'a\\b',
    '.',
    '..',
    '.hidden',
    'CON',
    'nul.txt',
    'trailing.',
    ' space',
    '',
  ])
    await assert.rejects(createFolder(root, '', name));
  await createFolder(root, '', 'Commander');
  await assert.rejects(createFolder(root, '', 'Commander'), /already exists/);
  const saved = await saveProject(root, { projectId: null, data: JSON.stringify(project) });
  await assert.rejects(createFolder(root, saved.id, 'Artwork'), /saved project/);
  await assert.rejects(moveProject(root, saved.id, `${saved.id}/assets`), /saved project/);
  await assert.rejects(moveProject(root, saved.id, '../outside'));
  let parent = '';
  for (let index = 0; index < 8; index++) parent = await createFolder(root, parent, 'nested');
  await assert.rejects(createFolder(root, parent, 'too-deep'), /eight levels/);
  const deep = await saveProject(root, {
    projectId: null,
    folder: parent,
    data: JSON.stringify(project),
  });
  assert.equal(
    (await listProjects(root)).some((item) => item.id === deep.id),
    true,
  );
});

test(
  'library traversal and nested operations skip symlinked ancestors and damaged projects',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'skarix-folder-links-'));
    const outside = await fs.mkdtemp(path.join(tmpdir(), 'skarix-outside-library-'));
    t.after(() =>
      Promise.all([
        fs.rm(root, { recursive: true, force: true }),
        fs.rm(outside, { recursive: true, force: true }),
      ]),
    );
    const saved = await saveProject(outside, { projectId: null, data: JSON.stringify(project) });
    await fs.symlink(outside, path.join(root, 'linked'));
    await fs.mkdir(path.join(outside, 'Empty'));
    await assert.rejects(deleteFolder(root, 'linked'), /unavailable/);
    await assert.rejects(deleteFolder(root, 'linked/Empty'), /unavailable/);
    assert.equal((await fs.stat(path.join(outside, 'Empty'))).isDirectory(), true);
    await assert.rejects(openProject(root, `linked/${saved.id}`), /unavailable/);
    await assert.rejects(createFolder(root, 'linked', 'escape'), /unavailable/);
    await assert.rejects(
      saveProject(root, { projectId: null, folder: 'linked', data: JSON.stringify(project) }),
      /unavailable/,
    );
    await fs.mkdir(path.join(root, 'damaged', 'assets'), { recursive: true });
    await fs.writeFile(path.join(root, 'damaged', PROJECT_FILE), 'invalid JSON');
    assert.deepEqual(await listLibrary(root), { projects: [], folders: [] });
  },
);

test('legacy import preserves nested folders and empty folders alongside their artwork', async (t) => {
  const source = await fs.mkdtemp(path.join(tmpdir(), 'skarix-import-source-'));
  const destination = await fs.mkdtemp(path.join(tmpdir(), 'skarix-import-dest-'));
  t.after(() =>
    Promise.all([
      fs.rm(source, { recursive: true, force: true }),
      fs.rm(destination, { recursive: true, force: true }),
    ]),
  );
  await createFolder(source, '', 'Commander');
  await createFolder(source, 'Commander', 'Budget');
  await createFolder(source, '', 'Empty');
  await createFolder(destination, '', 'Commander');
  const saved = await saveProject(source, {
    projectId: null,
    folder: 'Commander/Budget',
    data: JSON.stringify(project),
  });
  const imported = await importProjects(source, destination);
  assert.equal(imported[0].id, saved.id);
  assert.equal((await listLibrary(destination)).folders.length, 3);
  assert.equal(
    ((await openProject(destination, imported[0].id)) as typeof project).entries[0].card.faces[0]
      .image,
    tinyPng,
  );
  assert.equal((await listProjects(source)).length, 1);
});

test('Windows project moves preserve artwork and the saved date; failed moves retain the source', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'skarix-windows-move-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await createFolder(root, '', 'Destination');
  const source = await saveProject(root, { projectId: null, data: JSON.stringify(project) });
  const code = await fs.readFile(
    new URL('../electron/project-library.cjs', import.meta.url),
    'utf8',
  );
  function windowsLibrary(failMove: boolean) {
    const module = { exports: {} as { moveProject: typeof moveProject } };
    vm.runInNewContext(code, {
      module,
      Buffer,
      process: { platform: 'win32' },
      require: (id: string) => {
        if (id === 'node:fs/promises' && failMove)
          return {
            ...fs,
            rename: async (_source: string, target: string) => {
              await fs.mkdir(target);
              await fs.writeFile(path.join(target, 'another-users-file.txt'), 'keep me');
              throw new Error('project is in use');
            },
          };
        return require(id);
      },
    });
    return module.exports;
  }
  await assert.rejects(
    windowsLibrary(true).moveProject(root, source.id, 'Destination'),
    /project is in use/,
  );
  assert.equal(
    await fs.readFile(path.join(root, 'Destination', source.id, 'another-users-file.txt'), 'utf8'),
    'keep me',
  );
  assert.equal(
    ((await openProject(root, source.id)) as typeof project).entries[0].card.faces[0].image,
    tinyPng,
  );
  const moved = await windowsLibrary(false).moveProject(root, source.id, 'Destination');
  assert.equal(moved.id, `Destination/${source.id}-2`);
  assert.equal(moved.updatedAt, source.updatedAt);
  assert.equal(
    ((await openProject(root, moved.id)) as typeof project).entries[0].card.faces[0].image,
    tinyPng,
  );
  await assert.rejects(openProject(root, source.id));
});

test('legacy project manifests remain readable and save under the Skarix filename', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'skarix-legacy-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const saved = await saveProject(root, { projectId: null, data: JSON.stringify(project) });
  const current = path.join(root, saved.id, PROJECT_FILE);
  await fs.rename(current, path.join(root, saved.id, 'project.criprox.json'));
  assert.equal((await listProjects(root)).length, 1);
  const opened = (await openProject(root, saved.id)) as typeof project;
  assert.equal(opened.entries[0].card.faces[0].image, tinyPng);
  await saveProject(root, {
    projectId: saved.id,
    data: JSON.stringify({ ...opened, name: 'Migrated' }),
  });
  assert.equal(JSON.parse(await fs.readFile(current, 'utf8')).name, 'Migrated');
  assert.equal((await listProjects(root))[0].name, 'Migrated');
});
