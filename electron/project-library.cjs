const crypto = require('node:crypto');
const { constants: fsConstants } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

const PROJECT_FILE = 'project.skarix.json';
const LEGACY_PROJECT_FILE = 'project.criprox.json';
async function existingProjectFile(directory) {
  for (const name of [PROJECT_FILE, LEGACY_PROJECT_FILE]) {
    const file = path.join(directory, name);
    try {
      await fs.lstat(file);
      return file;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const error = new Error('Project file not found.');
  error.code = 'ENOENT';
  throw error;
}
const MAX_PROJECT_BYTES = 100_000_000;
const MAX_ARTWORK_BYTES = 20_000_000;
const projectIdPattern = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const managedArtworkPattern = /^assets\/[a-f0-9]{24}\.(?:png|jpg|webp)$/;
const dataImagePattern = /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=]+)$/i;
const readOnlyNoFollow = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;

async function readRegularFile(filePath, { minBytes = 0, maxBytes, encoding, errorMessage }) {
  let handle;
  try {
    handle = await fs.open(filePath, readOnlyNoFollow);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < minBytes || stat.size > maxBytes)
      throw new Error(errorMessage);
    const contents = await handle.readFile(encoding);
    const bytesRead = Buffer.isBuffer(contents) ? contents.length : Buffer.byteLength(contents);
    if (bytesRead < minBytes || bytesRead > maxBytes) throw new Error(errorMessage);
    return { contents, stat };
  } catch (error) {
    if (error?.code === 'ELOOP' || error?.code === 'EMLINK') throw new Error(errorMessage);
    throw error;
  } finally {
    await handle?.close();
  }
}

function projectDirectoryName(name) {
  return (
    String(name || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '') || 'untitled-project'
  );
}

function assertProjectId(projectId) {
  if (typeof projectId !== 'string') throw new Error('Invalid project identifier.');
  const parts = projectId.split('/');
  if (parts.some((part) => !part)) throw new Error('Invalid project identifier.');
  if (!projectIdPattern.test(parts.pop())) throw new Error('Invalid project identifier.');
  assertFolderPath(parts.join('/'));
  return projectId;
}

function assertFolderName(name) {
  if (
    typeof name !== 'string' ||
    !name ||
    name.length > 80 ||
    name.trim() !== name ||
    name.startsWith('.') ||
    /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
    name.endsWith('.') ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
    throw new Error(
      'Use a folder name of 1–80 characters without slashes or special filename characters.',
    );
  return name;
}

function assertFolderPath(folder) {
  if (typeof folder !== 'string') throw new Error('Invalid library folder.');
  if (folder === '') return folder;
  const parts = folder.split('/');
  if (parts.length > 8) throw new Error('Library folders can be nested up to eight levels.');
  parts.forEach(assertFolderName);
  return folder;
}

// Validate every ancestor: an otherwise valid path must never follow a symlink
// or descend into a project's private artwork directory.
async function assertLibraryFolder(root, folder) {
  assertFolderPath(folder);
  let directory = root;
  for (const part of folder ? folder.split('/') : []) {
    directory = path.join(directory, part);
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Library folder is unavailable.');
    try {
      await existingProjectFile(directory);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error('A saved project cannot be used as a library folder.');
  }
  return directory;
}

async function createFolder(root, parent, name) {
  await fs.mkdir(root, { recursive: true });
  const folder = [assertFolderPath(parent), assertFolderName(name)].filter(Boolean).join('/');
  assertFolderPath(folder);
  const directory = await assertLibraryFolder(root, parent);
  try {
    await fs.mkdir(path.join(directory, name));
  } catch (error) {
    if (error?.code === 'EEXIST')
      throw new Error('A folder or project with that name already exists.');
    throw error;
  }
  return folder;
}

async function deleteFolder(root, folder) {
  assertFolderPath(folder);
  if (!folder) throw new Error('The project library itself cannot be deleted.');
  const directory = await assertLibraryFolder(root, folder);
  try {
    // rmdir checks emptiness at removal time, including hidden and unlisted files.
    // Never recursively remove library folders or their contents.
    await fs.rmdir(directory);
  } catch (error) {
    if (error?.code === 'ENOTEMPTY' || error?.code === 'EEXIST')
      throw new Error('Only empty folders can be deleted. Refresh projects to see its contents.');
    throw error;
  }
}

function parseProjectData(data) {
  if (typeof data !== 'string' || Buffer.byteLength(data) > MAX_PROJECT_BYTES)
    throw new Error('Project data is invalid or exceeds 100 MB.');
  let project;
  try {
    project = JSON.parse(data);
  } catch {
    throw new Error('Project data is not valid JSON.');
  }
  if (
    !project ||
    project.version !== 1 ||
    typeof project.name !== 'string' ||
    project.name.length > 100 ||
    !Array.isArray(project.entries)
  )
    throw new Error('This is not a supported Skarix project.');
  return project;
}

function decodeEmbeddedArtwork(value) {
  const match = typeof value === 'string' ? dataImagePattern.exec(value) : null;
  if (!match) throw new Error('Unsupported embedded artwork in project.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_ARTWORK_BYTES)
    throw new Error('Embedded artwork is invalid or exceeds 20 MB.');
  const extension = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const filename = `${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24)}.${extension}`;
  return { bytes, relativePath: `assets/${filename}` };
}

function externalizeProject(project) {
  const savedProject = JSON.parse(JSON.stringify(project));
  const assets = new Map();

  function externalize(value) {
    if (typeof value !== 'string' || !value.startsWith('data:')) return value;
    const { bytes, relativePath } = decodeEmbeddedArtwork(value);
    assets.set(relativePath, bytes);
    return relativePath;
  }

  function externalizeFace(face) {
    if (!face || typeof face !== 'object') return;
    face.image = externalize(face.image);
    face.preview = externalize(face.preview);
  }

  for (const entry of savedProject.entries) {
    if (!Array.isArray(entry?.card?.faces)) continue;
    for (const face of entry.card.faces) externalizeFace(face);
  }
  externalizeFace(savedProject.backArtwork);
  return { project: savedProject, assets };
}

async function hydrateProjectAssets(project, projectDirectory) {
  const hydrated = JSON.parse(JSON.stringify(project));
  const cache = new Map();
  let checkedAssetsDirectory = false;

  async function hydrate(value) {
    if (typeof value !== 'string' || !value.startsWith('assets/')) return value;
    if (!managedArtworkPattern.test(value)) throw new Error('Invalid managed artwork path.');
    if (cache.has(value)) return cache.get(value);
    if (!checkedAssetsDirectory) {
      const assetsStat = await fs.lstat(path.join(projectDirectory, 'assets'));
      if (!assetsStat.isDirectory() || assetsStat.isSymbolicLink())
        throw new Error('Managed artwork folder is unavailable.');
      checkedAssetsDirectory = true;
    }
    const absolutePath = path.join(projectDirectory, ...value.split('/'));
    const { contents: bytes } = await readRegularFile(absolutePath, {
      minBytes: 1,
      maxBytes: MAX_ARTWORK_BYTES,
      errorMessage: 'Managed artwork is invalid or exceeds 20 MB.',
    });
    const extension = path.extname(value).slice(1);
    const mime = extension === 'jpg' ? 'jpeg' : extension;
    const dataUrl = `data:image/${mime};base64,${bytes.toString('base64')}`;
    cache.set(value, dataUrl);
    return dataUrl;
  }

  async function hydrateFace(face) {
    if (!face || typeof face !== 'object') return;
    face.image = await hydrate(face.image);
    face.preview = await hydrate(face.preview);
  }

  for (const entry of hydrated.entries || []) {
    if (!Array.isArray(entry?.card?.faces)) continue;
    for (const face of entry.card.faces) await hydrateFace(face);
  }
  await hydrateFace(hydrated.backArtwork);
  return hydrated;
}

async function assertManagedProjectDirectory(root, projectId) {
  const parts = assertProjectId(projectId).split('/');
  const name = parts.pop();
  const parent = await assertLibraryFolder(root, parts.join('/'));
  const directory = path.join(parent, name);
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('Project folder is unavailable.');
  return directory;
}

async function allocateProjectDirectory(root, name, folder = '') {
  const parent = await assertLibraryFolder(root, folder);
  const base = projectDirectoryName(name);
  for (let suffix = 1; suffix <= 999; suffix += 1) {
    const leaf = suffix === 1 ? base : `${base.slice(0, 75)}-${suffix}`;
    const projectId = [folder, leaf].filter(Boolean).join('/');
    const directory = path.join(parent, leaf);
    try {
      await fs.mkdir(directory);
      return { projectId, directory };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Could not create a unique project folder.');
}

async function ensureAssetsDirectory(projectDirectory) {
  const assetsDirectory = path.join(projectDirectory, 'assets');
  try {
    const assetsStat = await fs.lstat(assetsDirectory);
    if (!assetsStat.isDirectory() || assetsStat.isSymbolicLink())
      throw new Error('Managed artwork folder is unavailable.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await fs.mkdir(assetsDirectory);
  }
  return assetsDirectory;
}

async function beginProjectSave(root, request) {
  await fs.mkdir(root, { recursive: true });
  const name = request?.name;
  if (typeof name !== 'string' || name.length > 100) throw new Error('Project name is invalid.');
  const existingId = request?.projectId;
  const allocated = existingId
    ? {
        projectId: assertProjectId(existingId),
        directory: await assertManagedProjectDirectory(root, existingId),
      }
    : await allocateProjectDirectory(root, name, request?.folder ?? '');
  return {
    ...allocated,
    isNew: !existingId,
    complete: false,
    assets: new Set(),
  };
}

function assertActiveSave(session) {
  if (!session || session.complete || typeof session.directory !== 'string')
    throw new Error('Project save is no longer active.');
}

async function writeProjectAssetBytes(session, relativePath, bytes) {
  assertActiveSave(session);
  if (!managedArtworkPattern.test(relativePath) || !Buffer.isBuffer(bytes))
    throw new Error('Managed artwork is invalid.');
  const assetsDirectory = await ensureAssetsDirectory(session.directory);
  const target = path.join(assetsDirectory, path.basename(relativePath));
  try {
    await fs.writeFile(target, bytes, { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const { contents: existing } = await readRegularFile(target, {
      minBytes: 1,
      maxBytes: MAX_ARTWORK_BYTES,
      errorMessage: 'Managed artwork file is unavailable.',
    });
    if (!existing.equals(bytes)) throw new Error('Managed artwork file is corrupted.');
  }
  session.assets.add(relativePath);
  return relativePath;
}

async function saveProjectAsset(session, dataUrl) {
  const { bytes, relativePath } = decodeEmbeddedArtwork(dataUrl);
  return writeProjectAssetBytes(session, relativePath, bytes);
}

function assertExternalizedProject(project, assets) {
  function assertValue(value) {
    if (typeof value !== 'string') return;
    if (value.startsWith('data:'))
      throw new Error('Embedded artwork must be saved separately from the project manifest.');
    if (value.startsWith('assets/')) {
      if (!managedArtworkPattern.test(value) || !assets.has(value))
        throw new Error('Project manifest references unavailable managed artwork.');
    }
  }

  function assertFace(face) {
    if (!face || typeof face !== 'object') return;
    assertValue(face.image);
    assertValue(face.preview);
  }

  for (const entry of project.entries) {
    if (!Array.isArray(entry?.card?.faces)) continue;
    for (const face of entry.card.faces) assertFace(face);
  }
  assertFace(project.backArtwork);
}

async function finishProjectSave(session, data) {
  assertActiveSave(session);
  const project = parseProjectData(data);
  assertExternalizedProject(project, session.assets);
  const target = path.join(session.directory, PROJECT_FILE);
  const temporary = path.join(session.directory, `.${PROJECT_FILE}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(project, null, 2), 'utf8');
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
  session.complete = true;
  const stat = await fs.stat(target);
  return projectSummary(session.projectId, project, stat);
}

async function abortProjectSave(session) {
  if (!session || session.complete) return;
  session.complete = true;
  if (session.isNew) await fs.rm(session.directory, { recursive: true, force: true });
}

function projectSummary(projectId, project, stat) {
  return {
    id: projectId,
    name: project.name,
    cardCount: project.entries.reduce(
      (total, entry) => total + (Number.isInteger(entry?.quantity) ? entry.quantity : 0),
      0,
    ),
    artworkCount: new Set(
      project.entries.flatMap((entry) =>
        Array.isArray(entry?.card?.faces)
          ? entry.card.faces.flatMap((face) => [face?.image, face?.preview])
          : [],
      ),
    ).size,
    updatedAt: stat.mtime.toISOString(),
  };
}

async function readProjectFile(projectDirectory) {
  const filePath = await existingProjectFile(projectDirectory);
  const { contents, stat } = await readRegularFile(filePath, {
    minBytes: 1,
    maxBytes: MAX_PROJECT_BYTES,
    encoding: 'utf8',
    errorMessage: 'Project data is invalid or exceeds 100 MB.',
  });
  return { project: parseProjectData(contents), stat };
}

async function listLibrary(root) {
  await fs.mkdir(root, { recursive: true });
  const projects = [];
  const folders = [];
  async function visit(folder) {
    const directory = await assertLibraryFolder(root, folder);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        assertFolderName(entry.name);
      } catch {
        continue;
      }
      const id = [folder, entry.name].filter(Boolean).join('/');
      const child = path.join(directory, entry.name);
      try {
        const { project, stat } = await readProjectFile(child);
        assertProjectId(id);
        projects.push(projectSummary(id, project, stat));
        continue;
      } catch {
        // Never browse assets inside incomplete or damaged project folders.
        try {
          await existingProjectFile(child);
          continue;
        } catch (error) {
          if (error?.code !== 'ENOENT') continue;
        }
      }
      try {
        assertFolderPath(id);
        await assertLibraryFolder(root, id);
        const empty = await visit(id);
        folders.push({ id, name: entry.name, parent: folder, empty });
      } catch {
        // Ignore inaccessible folders and links in a user-selected library.
      }
    }
    return entries.length === 0;
  }
  await visit('');
  return {
    projects: projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    folders: folders.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

async function listProjects(root) {
  return (await listLibrary(root)).projects;
}

async function moveProject(root, projectId, folder) {
  const source = await assertManagedProjectDirectory(root, projectId);
  const { project, stat } = await readProjectFile(source);
  await assertLibraryFolder(root, folder);
  if (projectId.split('/').slice(0, -1).join('/') === folder)
    return projectSummary(projectId, project, stat);
  // Reserve the destination without overwriting a same-named project.
  const target = await allocateProjectDirectory(root, path.basename(projectId), folder);
  let reserved = true;
  try {
    if (process.platform === 'win32') {
      // Windows refuses to replace even an empty directory. Release our empty
      // reservation first; its rename also refuses any directory created in the
      // meantime, so a collision leaves the original project intact.
      await fs.rmdir(target.directory);
      reserved = false;
    }
    await fs.rename(source, target.directory);
  } catch (error) {
    // Only remove our empty reservation, never another folder's contents.
    if (reserved) await fs.rmdir(target.directory).catch(() => {});
    throw error;
  }
  return projectSummary(target.projectId, project, stat);
}

async function saveProject(root, request) {
  const project = parseProjectData(request?.data);
  const { project: savedProject, assets } = externalizeProject(project);
  const session = await beginProjectSave(root, {
    projectId: request?.projectId,
    name: project.name,
    folder: request?.folder,
  });
  try {
    for (const [relativePath, bytes] of assets)
      await writeProjectAssetBytes(session, relativePath, bytes);
    return await finishProjectSave(session, JSON.stringify(savedProject));
  } catch (error) {
    await abortProjectSave(session).catch(() => {});
    throw error;
  }
}

async function openProjectManifest(root, projectId) {
  const directory = await assertManagedProjectDirectory(root, projectId);
  const { project } = await readProjectFile(directory);
  return project;
}

async function readProjectAsset(root, projectId, relativePath) {
  if (typeof relativePath !== 'string' || !managedArtworkPattern.test(relativePath))
    throw new Error('Invalid managed artwork path.');
  const directory = await assertManagedProjectDirectory(root, projectId);
  const assetsDirectory = path.join(directory, 'assets');
  const assetsStat = await fs.lstat(assetsDirectory);
  if (!assetsStat.isDirectory() || assetsStat.isSymbolicLink())
    throw new Error('Managed artwork folder is unavailable.');
  const absolutePath = path.join(directory, ...relativePath.split('/'));
  const { contents: bytes } = await readRegularFile(absolutePath, {
    minBytes: 1,
    maxBytes: MAX_ARTWORK_BYTES,
    errorMessage: 'Managed artwork is invalid or exceeds 20 MB.',
  });
  const extension = path.extname(relativePath).slice(1);
  const mime = extension === 'jpg' ? 'jpeg' : extension;
  return `data:image/${mime};base64,${bytes.toString('base64')}`;
}

async function openProject(root, projectId) {
  const directory = await assertManagedProjectDirectory(root, projectId);
  const { project } = await readProjectFile(directory);
  return hydrateProjectAssets(project, directory);
}

async function importProjects(sourceRoot, destinationRoot) {
  const imported = [];
  const library = await listLibrary(sourceRoot);
  for (const folder of library.folders.sort(
    (a, b) => a.id.split('/').length - b.id.split('/').length,
  )) {
    try {
      await createFolder(destinationRoot, folder.parent, folder.name);
    } catch (error) {
      await assertLibraryFolder(destinationRoot, folder.id);
    }
  }
  for (const source of library.projects) {
    const project = await openProject(sourceRoot, source.id);
    imported.push(
      await saveProject(destinationRoot, {
        projectId: null,
        folder: source.id.split('/').slice(0, -1).join('/'),
        data: JSON.stringify(project),
      }),
    );
  }
  return imported;
}

async function deleteProject(root, projectId, moveToTrash) {
  if (typeof moveToTrash !== 'function') throw new Error('Project deletion is unavailable.');
  const directory = await assertManagedProjectDirectory(root, projectId);
  await readProjectFile(directory);
  await moveToTrash(directory);
}

module.exports = {
  PROJECT_FILE,
  abortProjectSave,
  assertProjectId,
  beginProjectSave,
  createFolder,
  deleteFolder,
  deleteProject,
  externalizeProject,
  finishProjectSave,
  hydrateProjectAssets,
  importProjects,
  listProjects,
  listLibrary,
  moveProject,
  openProject,
  openProjectManifest,
  projectDirectoryName,
  readProjectAsset,
  saveProject,
  saveProjectAsset,
};
