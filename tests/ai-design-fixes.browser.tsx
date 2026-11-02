import { createRoot } from 'react-dom/client';
import { get, set, del } from 'idb-keyval';
import { projectFromDefaults, FACTORY_PROJECT_DEFAULTS } from '../src/lib/project-defaults';
import App from '../src/App';
import { invokeAiDesign, registerAiWorkspace, previewAiProject } from '../src/lib/ai-design';
import { newStickerProject, appendSticker, stickerSheets } from '../src/lib/stickers';
import { renderStickerSheet, bytesToBase64 } from '../src/lib/sticker-output';

import {
  rememberRecentProject,
  listRecentProjects,
  readRecentProject,
} from '../src/lib/recent-projects';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw Error(message);
}
const tick = () => new Promise((r) => setTimeout(r, 20));
async function until(fn: () => unknown | Promise<unknown>) {
  for (let i = 0; i < 100; i++) {
    try {
      if (await fn()) return;
    } catch {}
    await tick();
  }
  throw Error('Timed out waiting for renderer');
}
function artwork() {
  const c = document.createElement('canvas');
  c.width = 120;
  c.height = 60;
  const x = c.getContext('2d')!;
  x.fillStyle = 'white';
  x.fillRect(0, 0, 120, 60);
  x.fillStyle = 'red';
  x.fillRect(20, 10, 40, 40);
  x.fillStyle = 'blue';
  x.fillRect(60, 10, 40, 40);
  return c.toDataURL();
}
async function pixels(source: string) {
  const i = new Image();
  i.src = source;
  await i.decode();
  const c = document.createElement('canvas');
  c.width = i.width;
  c.height = i.height;
  const x = c.getContext('2d')!;
  x.fillStyle = 'white';
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(i, 0, 0);
  return { w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
}

export async function run() {
  const storage = await import('../src/lib/storage');
  await set('criprox-migration-test', { name: 'Saved draft' });
  check(
    (await storage.get<{ name: string }>('skarix-migration-test'))?.name === 'Saved draft',
    'Legacy draft was lost',
  );
  await storage.set('skarix-migration-test', { name: 'New draft' });
  check(
    (await storage.get<{ name: string }>('skarix-migration-test'))?.name === 'New draft',
    'Legacy draft overwrote current data',
  );
  await storage.del('skarix-migration-test');
  check(
    (await storage.get('skarix-migration-test')) === undefined,
    'Deleted draft was resurrected',
  );
  localStorage.setItem('criprox-migration-test', 'dark');
  check(storage.readLocalSetting('skarix-migration-test') === 'dark', 'Legacy preference was lost');
  localStorage.setItem('skarix-migration-test', 'light');
  check(
    storage.readLocalSetting('skarix-migration-test') === 'light',
    'Legacy preference overwrote current value',
  );
  localStorage.removeItem('criprox-migration-test');
  localStorage.removeItem('skarix-migration-test');
  const image = artwork();
  let p = newStickerProject();
  p.name = 'Original';
  p.artwork = [{ id: 'art', name: 'Artwork', image }];
  p = appendSticker(p, 'art');
  p.settings = {
    ...p.settings,
    fit: 'cover',
    borderWidth: 3,
    borderStrokeWidth: 1,
    borderStrokeColor: '#00ff00',
  };
  for (const transformed of [false, true]) {
    const candidate = structuredClone(p);
    if (transformed) candidate.poses![0] = { ...candidate.poses![0], rotation: 90, flipX: true };
    const sheet = stickerSheets(candidate)[0];
    const expected = await pixels(
      'data:image/png;base64,' +
        bytesToBase64(await renderStickerSheet(sheet, candidate, { maxPixels: 1000 })),
    );
    const actual = await pixels(
      await previewAiProject('stickers', candidate, { sheet: 0, maxPixels: 1000, showCuts: false }),
    );
    check(actual.w === expected.w && actual.h === expected.h, 'Preview dimensions differ');
    let changed = 0;
    for (let i = 0; i < actual.data.length; i++)
      if (Math.abs(actual.data[i] - expected.data[i]) > 3) changed++;
    check(
      changed / actual.data.length < 0.005,
      'Preview differs from printed crop, padding, stroke or transform',
    );
    const cutPreview = await pixels(
      await previewAiProject('stickers', candidate, { sheet: 0, maxPixels: 1000, showCuts: true }),
    );
    check(
      cutPreview.data.some((v, i) => v !== actual.data[i]),
      'Cut overlay absent',
    );
  }

  let busy = false,
    writes = 0,
    current = p;
  const stop = registerAiWorkspace('stickers', {
    read: () => current,
    write: (n) => {
      current = n as typeof p;
      writes++;
    },
    busy: () => busy,
    open: () => {},
    undo: () => {},
    redo: () => {},
  });
  const pending = invokeAiDesign('create_design', {
    workspace: 'stickers',
    name: 'Late edit',
    copies: 0,
  });
  busy = true;
  let rejected = false;
  try {
    await pending;
  } catch (e) {
    rejected = /editor operation/.test(String(e));
  }
  check(
    rejected && writes === 0 && current === p,
    'Late AI mutation overwrote active human editor',
  );
  stop();

  await set('skarix-sticker-draft-v1', p);
  const original = (await rememberRecentProject(p, 'stickers'))[0].id;
  localStorage.setItem('skarix-recent-active', JSON.stringify({ stickers: original }));
  const unsavedLegacy = {
    ...projectFromDefaults(FACTORY_PROJECT_DEFAULTS),
    name: 'Unsaved card edits',
    recoverySentinel: 'raw fields survive',
  };
  await set('skarix-project', unsavedLegacy);
  const root = createRoot(document.getElementById('root')!);
  root.render(<App />);
  await until(
    async () =>
      (await invokeAiDesign('get_workspace', { workspace: 'stickers' })).name === 'Original',
  );
  const recoveryButton = () =>
    [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Export last autosaved card draft'),
    );
  await until(() => recoveryButton() && !recoveryButton()!.disabled);
  check(
    !(await listRecentProjects()).some((r) => r.name === unsavedLegacy.name),
    'Recovery fixture unexpectedly present in Recents',
  );
  let exportedLegacy: Blob | undefined;
  const originalObjectUrl = URL.createObjectURL;
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = (blob) => {
    exportedLegacy = blob as Blob;
    return originalObjectUrl(blob);
  };
  HTMLAnchorElement.prototype.click = () => {};
  try {
    recoveryButton()!.click();
  } finally {
    URL.createObjectURL = originalObjectUrl;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
  }
  check(
    exportedLegacy &&
      JSON.stringify(JSON.parse(await exportedLegacy.text())) === JSON.stringify(unsavedLegacy),
    'Unsaved legacy draft export lost latest or unknown fields',
  );
  check(
    JSON.stringify(await get('skarix-project')) === JSON.stringify(unsavedLegacy),
    'Recovery altered stored card draft',
  );
  // Creating and loading both replace the workspace, but must not reuse the prior recent ID.
  await invokeAiDesign('create_project', { workspace: 'stickers', name: 'AI new' });
  await tick();

  check(
    (await readRecentProject(original)).name === 'Original',
    'Original cached project was replaced',
  );
  await invokeAiDesign('create_design', { workspace: 'stickers', name: 'New art', copies: 1 });
  await tick();
  const replacement = { ...structuredClone(p), name: 'AI loaded' };
  await invokeAiDesign('load_project', { workspace: 'stickers', project: replacement });
  await tick();

  const recents = await listRecentProjects();
  check(
    recents.some((r) => r.name === 'AI new') && recents.some((r) => r.name === 'Original'),
    'Replacement did not preserve separate prior snapshots',
  );
  (document.querySelector('button[aria-label="Skarix Home"]') as HTMLButtonElement).click();
  await until(async () => (await listRecentProjects()).some((r) => r.name === 'AI loaded'));
  const final = await listRecentProjects();
  check(
    new Set(
      final.filter((r) => ['Original', 'AI new', 'AI loaded'].includes(r.name)).map((r) => r.id),
    ).size === 3,
    'Recent projects share IDs',
  );
  check((await readRecentProject(original)).name === 'Original', 'Home save overwrote original');
  root.unmount();
  await tick();
  await del('skarix-sticker-draft-v1');
  const freshRoot = createRoot(document.getElementById('root')!);
  freshRoot.render(<App />);
  await until(
    async () =>
      (await invokeAiDesign('get_workspace', { workspace: 'stickers' })).name === 'Meet Skarix',
  );
  const starter = await invokeAiDesign('export_project', { workspace: 'stickers' });
  check(
    starter.project.items.length === 1 && starter.project.artwork[0].design.elements.length === 10,
    'Editable starter missing',
  );
  check(
    !document.body.textContent?.includes('Proxy Card Builder'),
    'Gaming workspace still exposed',
  );
  const starterArtworkId = starter.project.artwork[0].id;
  await invokeAiDesign('edit_design', {
    workspace: 'stickers',
    designId: starterArtworkId,
    operations: [
      {
        action: 'update',
        id: starter.project.artwork[0].design.elements.find(
          (e: { text?: string }) => e.text === 'skarix',
        ).id,
        patch: { text: 'My customized starter' },
      },
    ],
  });
  await tick();
  (document.querySelector('button[aria-label="Skarix Home"]') as HTMLButtonElement).click();
  const starterButton = () =>
    [...document.querySelectorAll('button')].find(
      (b) => b.querySelector('strong')?.textContent === 'Meet Skarix',
    );
  await until(() => starterButton() && !starterButton()!.disabled);
  starterButton()!.click();
  await until(
    async () =>
      (await invokeAiDesign('export_project', { workspace: 'stickers' })).project.artwork[0].id !==
      starterArtworkId,
  );
  const newStarter = (await invokeAiDesign('export_project', { workspace: 'stickers' })).project;
  check(
    newStarter.name === 'Meet Skarix' && newStarter.items[0] === newStarter.artwork[0].id,
    'New starter identity is not consistently placed',
  );
  const sameName = (await listRecentProjects()).filter((r) => r.name === 'Meet Skarix');
  const snapshots = await Promise.all(sameName.map((r) => readRecentProject(r.id)));
  check(
    snapshots.some(
      (p) =>
        'artwork' in p &&
        p.artwork.some(
          (a) =>
            a.id === starterArtworkId &&
            a.design?.elements.some((e) => e.text === 'My customized starter'),
        ),
    ),
    'New starter deleted customized same-name recent project',
  );
  check(
    snapshots.some(
      (p) => 'artwork' in p && p.artwork.some((a) => a.id === newStarter.artwork[0].id),
    ),
    'New starter recent snapshot absent',
  );
  freshRoot.unmount();
  await tick();
  const blank = { ...newStickerProject(), name: 'Intentionally blank' };
  await set('skarix-sticker-draft-v1', blank);
  const blankRoot = createRoot(document.getElementById('root')!);
  blankRoot.render(<App />);
  await until(
    async () =>
      (await invokeAiDesign('get_workspace', { workspace: 'stickers' })).name === blank.name,
  );
  check(
    (await invokeAiDesign('export_project', { workspace: 'stickers' })).project.artwork.length ===
      0,
    'Starter overwrote blank draft',
  );
  blankRoot.unmount();
  await tick();
  const legacy = { ...projectFromDefaults(FACTORY_PROJECT_DEFAULTS), name: 'Preserved legacy' };
  await rememberRecentProject(legacy, 'cards', 'legacy-sentinel');
  for (let i = 0; i < 10; i++)
    await rememberRecentProject({ ...p, name: 'Recent ' + i }, 'stickers');
  check(
    JSON.stringify(await readRecentProject('legacy-sentinel')) === JSON.stringify(legacy),
    'Legacy project evicted or changed',
  );
  // Exercise the visible update notification with the real App and IPC state events.
  const originalBridge = window.skarix;
  let listener: ((state: UpdateState) => void) | undefined;
  let checks = 0;
  let downloads = 0;
  let unsubscribed = false;
  const available: UpdateState = {
    currentVersion: '0.19.0',
    status: 'available',
    changelog: [],
    lastChecked: new Date().toISOString(),
    transferred: 0,
    total: 0,
    error: '',
    update: {
      currentVersion: '0.19.0',
      latestVersion: '0.20.0',
      releaseUrl: 'https://github.com/doudar/Skarix/releases/tag/v0.20.0',
      releaseNotes: 'New artwork tools',
      releaseHeading: 'New artwork tools',
      releaseNotesHtml: '<p>New artwork tools</p>',
      publishedAt: null,
      installerName: null,
      downloadSize: null,
      canDownload: false,
    },
  };
  const checkRelease = async () => {
    checks++;
    return available;
  };
  window.skarix = {
    ...originalBridge,
    releases: {
      check: checkRelease,
      checkNow: checkRelease,
      state: async () => available,
      onState: (cb) => {
        listener = cb;
        return () => {
          unsubscribed = true;
        };
      },
      download: async () => {
        downloads++;
        return available;
      },
      cancel: async () => available,
      openInstaller: async () => available,
      copyMacCommand: async () => {},
      openTerminal: async () => {},
      open: async () => {},
      openLink: async () => {},
    },
  } as typeof window.skarix;
  const updateRoot = createRoot(document.getElementById('root')!);
  try {
    updateRoot.render(<App />);
    const notice = () => document.querySelector<HTMLButtonElement>('.skarix-update-notice');
    await until(() => notice()?.textContent?.includes('0.20.0'));
    check(checks === 1, 'Missing startup release check');
    notice()!.click();
    await until(() => document.querySelector('dialog[open] .updates-panel'));
    check(
      document.querySelector('.updates-panel')!.textContent!.includes('0.19.0'),
      'Update notice did not open the installed version and release details',
    );
    window.dispatchEvent(new Event('focus'));
    await until(() => checks === 2);
    listener!({ ...available, status: 'up-to-date', update: null });
    await until(() => !notice());
    check(downloads === 0, 'Checking updates started a download');
  } finally {
    updateRoot.unmount();
    window.skarix = originalBridge;
  }
  check(unsubscribed, 'Update subscription leaked after unmount');
  const checksAfterUnmount = checks;
  window.dispatchEvent(new Event('focus'));
  await tick();
  check(checks === checksAfterUnmount, 'Update focus listener leaked after unmount');
  return 'PASS: raw unsaved card draft export without mutation, same-name customized starter preserved, fresh starter, existing and blank drafts, preserved legacy snapshots, preview pixels match shared output with borders/cropping/transforms, late edits preserve the active designer, real App create/load/Home keeps three separate recent projects, and newer GitHub releases appear in the header and open update details without downloading.';
}
