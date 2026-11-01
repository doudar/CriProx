import { createRoot } from 'react-dom/client';
import { set } from 'idb-keyval';
import App from '../src/App';
import { invokeAiDesign, registerAiWorkspace, previewAiProject } from '../src/lib/ai-design';
import { newStickerProject, appendSticker, stickerSheets } from '../src/lib/stickers';
import { renderStickerSheet, bytesToBase64 } from '../src/lib/sticker-output';
import { DEFAULT_SETTINGS } from '../src/lib/types';
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

  let cards: any = {
    version: 1,
    name: 'Catalog',
    entries: [
      {
        id: 'catalog',
        quantity: 1,
        face: 0,
        card: {
          id: 'catalog',
          name: 'Catalog',
          set: 'test',
          setName: 'Test',
          collector: '1',
          faces: [
            {
              name: 'Catalog',
              image: 'https://cards.scryfall.io/normal/front/test.png',
              preview: 'https://cards.scryfall.io/normal/front/test.png',
            },
          ],
        },
      },
    ],
    settings: structuredClone(DEFAULT_SETTINGS),
  };
  const stopCards = registerAiWorkspace('cards', {
    read: () => cards,
    write: (n) => (cards = n),
    open: () => {},
    busy: () => false,
    undo: () => {},
    redo: () => {},
  });
  await invokeAiDesign('edit_design', {
    workspace: 'cards',
    designId: 'catalog',
    operations: [{ action: 'add', element: { kind: 'text', text: 'Edited catalog card' } }],
  });
  check(
    cards.entries[0].card.faces[0].design.elements[0].image.startsWith('data:image/png;base64,'),
    'Catalog artwork not embedded',
  );
  check(
    cards.entries[0].card.faces[0].design.elements.some(
      (e: any) => e.text === 'Edited catalog card',
    ),
    'Catalog edit missing',
  );
  stopCards();

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

  await set('criprox-sticker-draft-v1', p);
  const original = (await rememberRecentProject(p, 'stickers'))[0].id;
  localStorage.setItem('criprox-recent-active', JSON.stringify({ stickers: original }));
  const root = createRoot(document.getElementById('root')!);
  root.render(<App />);
  await until(
    async () =>
      (await invokeAiDesign('get_workspace', { workspace: 'stickers' })).name === 'Original',
  );
  // Creating and loading both replace the workspace, but must not reuse the prior recent ID.
  await invokeAiDesign('create_project', { workspace: 'stickers', name: 'AI new' });
  await tick();
  check(
    !JSON.parse(localStorage.getItem('criprox-recent-active')!).stickers,
    'New project retained old recent ID',
  );
  check(
    (await readRecentProject(original)).name === 'Original',
    'Original cached project was replaced',
  );
  await invokeAiDesign('create_design', { workspace: 'stickers', name: 'New art', copies: 1 });
  await tick();
  const replacement = { ...structuredClone(p), name: 'AI loaded' };
  await invokeAiDesign('load_project', { workspace: 'stickers', project: replacement });
  await tick();
  check(
    !JSON.parse(localStorage.getItem('criprox-recent-active')!).stickers,
    'Loaded project retained prior recent ID',
  );
  const recents = await listRecentProjects();
  check(
    recents.some((r) => r.name === 'AI new') && recents.some((r) => r.name === 'Original'),
    'Replacement did not preserve separate prior snapshots',
  );
  const select = document.querySelector('select[aria-label="Workspace"]') as HTMLSelectElement;
  check(select, 'Workspace selector missing');
  select.value = 'home';
  select.dispatchEvent(new Event('change', { bubbles: true }));
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
  return 'PASS: catalog artwork becomes editable, preview pixels match shared output with borders/cropping/transforms, late edits preserve the active designer, and real App create/load/Home keeps three separate recent projects.';
}
