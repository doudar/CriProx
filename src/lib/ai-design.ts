import { designTool, DESIGN_TOOLS } from '../../electron/ai-tools.cjs';
import { DEFAULT_SETTINGS, type Project, type CardFace } from './types';
import { validateProject } from './project';
import {
  newDesign,
  newElement,
  validateStickerDesign,
  renderStickerDesign,
  designSvg,
  FONTS,
  SHAPES,
  PALETTES,
  type StickerDesign,
  type DesignElement,
} from './sticker-design';
import {
  newStickerProject,
  validateStickerProject,
  stickerPoses,
  stickerSheets,
  appendSticker,
  editSticker,
  duplicateSticker,
  removeStickers,
  changeStickerSettings,
  type StickerProject,
} from './stickers';
import { designOutputBounds, designCutPaths, pathSvg } from './sticker-contours';
import { fitDesignCut } from './sticker-fit-cut';
import { runStickerLayout } from './sticker-layout-task';
import { importStickerSvg } from './sticker-svg';
import { layout } from './layout';
import { renderStickerSheet, bytesToBase64 } from './sticker-output';
import { stickerLocalCuts } from './sticker-cuts';
import { searchCards, resolveCardIds } from './scryfall';

export type AiMode = 'cards' | 'stickers';
export type AiProject = Project | StickerProject;
export type AiWorkspace = {
  read: () => AiProject;
  write: (value: AiProject, fresh?: boolean) => void;
  undo: () => void;
  redo: () => void;
  open: (fresh?: boolean) => void;
  beforeReplace?: () => Promise<void>;
  busy: () => boolean;
};
const workspaces = new Map<AiMode, AiWorkspace>();
let requestEpoch = 0,
  requestController = new AbortController();
export function cancelAiDesignRequests() {
  requestEpoch++;
  requestController.abort();
  requestController = new AbortController();
}
export function registerAiWorkspace(mode: AiMode, controller: AiWorkspace) {
  workspaces.set(mode, controller);
  return () => {
    if (workspaces.get(mode) === controller) workspaces.delete(mode);
  };
}
export const AI_DESIGN_GUIDE = {
  units:
    'millimeters; top-left origin; rotation in degrees clockwise; paths use normalized 0..1 points',
  safety:
    'Design and preview only. No printing, print preparation, cutter discovery/connection/control, calibration, execution, shell, JavaScript or arbitrary IPC tools exist. Human users print and cut in the app.',
  limits: {
    layers: 500,
    pointsPerPath: 2000,
    totalPoints: 100000,
    canvasMm: [10, 250],
    copies: 500,
    embeddedImageBytes: 14000000,
  },
  shapes: SHAPES,
  fonts: FONTS,
  palettes: PALETTES,
  editing:
    'Each operation is undoable. Read workspace first and use its IDs. Batch related layer changes in edit_design. Reorder takes every element ID, bottom to top. Existing image-only assets can be converted to editable designs by edit_design.',
  illustration:
    'Build detailed scenes from many filled closed draw paths and shapes, with separate sky, clouds, mountain ridges, water, vegetation and highlights. Use normalized path points and opacity for shading; preview and refine. Or embed a detailed raster produced by your image generation tool; CriProx does not itself call an image model.',
  cards:
    'create_design workspace=cards creates a new custom card; hero provides title/subtitle/rules/stats/accent/artwork as an editable starting frame. All text and illustration layers remain editable. Card fronts use project card dimensions; do not apply crop-to-cut to a card.',
  templates:
    'A landscape can use a full-canvas sky, a sun ellipse, several closed mountain polygons, and short line/shape details. A hero card can use the hero template, then add its original illustration and edit all frame/text layers.',
  tools: DESIGN_TOOLS.map((t) => ({ name: t.name, description: t.description })),
};
const clone = <T>(v: T): T => structuredClone(v);
function validate(mode: AiMode, p: AiProject) {
  return mode === 'cards' ? validateProject(clone(p)) : validateStickerProject(clone(p));
}
function ws(mode: AiMode) {
  const c = workspaces.get(mode);
  if (!c) throw Error('The workspace is still loading. Open CriProx and try again.');
  if (c.busy()) throw Error('Finish the current editor operation before AI edits.');
  return c;
}
function findDesign(mode: AiMode, p: AiProject, id: string) {
  if (mode === 'stickers') {
    const a = (p as StickerProject).artwork.find((a) => a.id === id);
    if (!a) throw Error('Design not found.');
    return { name: a.name, image: a.image, design: a.design };
  }
  const e = (p as Project).entries.find((e) => e.id === id);
  if (!e) throw Error('Card entry not found.');
  const f = e.card.faces[e.face];
  return { name: e.card.name, image: f.image, design: f.design };
}
export function applyDesignOperations(
  design: StickerDesign,
  operations: any[],
  canvas?: any,
): StickerDesign {
  const d = clone(design);
  Object.assign(d, canvas || {});
  for (const op of operations) {
    const i = d.elements.findIndex((e) => e.id === op.id);
    if (op.action === 'add') {
      if (!op.element.kind) throw Error('New layers require kind.');
      d.elements.push({ ...newElement(op.element.kind, d), ...op.element });
    } else if (op.action === 'reorder') {
      if (
        op.ids.length !== d.elements.length ||
        new Set(op.ids).size !== d.elements.length ||
        op.ids.some((id: string) => !d.elements.some((e) => e.id === id))
      )
        throw Error('Reorder must include every layer ID exactly once.');
      d.elements = op.ids.map((id: string) => d.elements.find((e) => e.id === id)!);
    } else {
      if (i < 0) throw Error('Layer not found.');
      if (op.action === 'remove') d.elements.splice(i, 1);
      else if (op.action === 'update') {
        if (op.patch.id && op.patch.id !== op.id) throw Error('Layer IDs cannot be changed.');
        if (op.patch.kind && op.patch.kind !== d.elements[i].kind)
          throw Error('Replace the layer to change its kind.');
        d.elements[i] = { ...d.elements[i], ...op.patch };
      } else if (op.action === 'duplicate') {
        const e = d.elements[i];
        d.elements.splice(i + 1, 0, {
          ...clone(e),
          id: op.newId || crypto.randomUUID(),
          x: e.x + op.dx,
          y: e.y + op.dy,
        });
      }
    }
  }
  return validateStickerDesign(d);
}
export function heroDesign(width: number, height: number, hero: any): StickerDesign {
  const d = newDesign(width, height);
  d.background = '#172033';
  const layer = (kind: DesignElement['kind'], patch: Partial<DesignElement>) => ({
    ...newElement(kind, d),
    ...patch,
  });
  const accent = hero.accent || '#d4b66a';
  d.elements = [
    layer('shape', {
      x: 2,
      y: 2,
      width: width - 4,
      height: height - 4,
      fill: '#24344d',
      stroke: accent,
      strokeWidth: 0.6,
      cornerRadius: 2,
    }),
    layer('shape', {
      x: 4,
      y: 14,
      width: width - 8,
      height: height * 0.43,
      fill: '#425d72',
      stroke: accent,
      strokeWidth: 0.3,
    }),
    ...(hero.artwork
      ? [
          layer('image', {
            x: 4,
            y: 14,
            width: width - 8,
            height: height * 0.43,
            image: hero.artwork,
          }),
        ]
      : []),
    layer('text', {
      x: 4,
      y: 4,
      width: width - 8,
      height: 7,
      text: hero.title,
      font: 'Georgia',
      fontSize: 4.2,
      bold: true,
      fill: accent,
      align: 'left',
    }),
    layer('text', {
      x: 4,
      y: height * 0.43 + 16,
      width: width - 8,
      height: 6,
      text: hero.subtitle || 'Original hero',
      fontSize: 2.8,
      bold: true,
      fill: accent,
      align: 'left',
    }),
    layer('text', {
      x: 5,
      y: height * 0.43 + 24,
      width: width - 10,
      height: height * 0.22,
      text: hero.rules || 'Write your hero’s abilities here.',
      fontSize: 2.7,
      fill: '#ffffff',
      align: 'left',
    }),
    layer('text', {
      x: 5,
      y: height - 10,
      width: width - 10,
      height: 6,
      text: hero.stats || 'Health 20 · Power 3',
      fontSize: 3,
      bold: true,
      fill: accent,
      align: 'right',
    }),
  ];
  return validateStickerDesign(d);
}
async function storeDesign(
  mode: AiMode,
  p: AiProject,
  id: string,
  name: string,
  d: StickerDesign,
  copies = 0,
): Promise<AiProject> {
  d = validateStickerDesign(d);
  d = { ...d, cropToCuts: mode === 'stickers' };
  const image = await renderStickerDesign(d);
  if (mode === 'stickers') {
    let s = p as StickerProject;
    const old = s.artwork.find((a) => a.id === id);
    const b = designOutputBounds(d);
    if (old) {
      const prev = old.design ? designOutputBounds(old.design) : b;
      s = {
        ...s,
        version: 2,
        capture: undefined,
        poses: stickerPoses(s).map((pose, i) =>
          s.items[i] === id
            ? {
                ...pose,
                width: (pose.width * b.width) / prev.width,
                height: (pose.height * b.height) / prev.height,
                radius: Math.min(
                  pose.radius,
                  (pose.width * b.width) / prev.width / 2,
                  (pose.height * b.height) / prev.height / 2,
                ),
              }
            : pose,
        ),
        artwork: s.artwork.map((a) => (a.id === id ? { id, name, image, design: d } : a)),
      };
    } else s = { ...s, artwork: [...s.artwork, { id, name, image, design: d }] };
    for (let i = 0; i < copies; i++) s = appendSticker(s, id, b);
    return validateStickerProject(s);
  }
  const c = p as Project;
  const index = c.entries.findIndex((e) => e.id === id);
  const face: CardFace = { name, image, preview: image, design: d };
  if (index < 0) {
    if (copies < 1) throw Error('Cards need at least one copy.');
    return validateProject({
      ...c,
      entries: [
        ...c.entries,
        {
          id,
          quantity: copies,
          face: 0,
          card: {
            id,
            name,
            set: 'custom',
            setName: 'Custom designs',
            collector: '',
            faces: [face],
          },
        },
      ],
    });
  }
  return validateProject({
    ...c,
    entries: c.entries.map((e, i) =>
      i === index
        ? {
            ...e,
            card: { ...e.card, name, faces: e.card.faces.map((f, j) => (j === e.face ? face : f)) },
          }
        : e,
    ),
  });
}
async function pngFromSvg(svg: string, maxPixels: number): Promise<string> {
  const image = new Image(),
    url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await document.fonts.ready;
    image.src = url;
    await image.decode();
    const scale = maxPixels / Math.max(image.width, image.height);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(image.width * scale));
    c.height = Math.max(1, Math.ceil(image.height * scale));
    c.getContext('2d')!.drawImage(image, 0, 0, c.width, c.height);
    const png = c.toDataURL('image/png');
    c.width = c.height = 0;
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function pngFromImage(source: string, maxPixels: number): Promise<string> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = source;
  await image.decode();
  const scale = Math.min(1, maxPixels / Math.max(image.width, image.height)),
    canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(image.width * scale));
  canvas.height = Math.max(1, Math.ceil(image.height * scale));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = canvas.toDataURL('image/png');
  canvas.width = canvas.height = 0;
  return result;
}
const xml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
export async function previewAiProject(mode: AiMode, p: AiProject, args: any): Promise<string> {
  if (args.designId) {
    const a = findDesign(mode, p, args.designId);
    if (a.design) {
      let svg = designSvg(a.design);
      if (args.showCuts) {
        const paths = designCutPaths(a.design)
          .map(
            (path) =>
              `<path d="${pathSvg(path)}" fill="none" stroke="#ec268f" stroke-width=".15" stroke-dasharray=".8 .6"/>`,
          )
          .join('');
        svg = svg.replace('</svg>', paths + '</svg>');
      }
      return pngFromSvg(svg, args.maxPixels);
    }
    return pngFromImage(a.image, args.maxPixels);
  }
  let w: number,
    h: number,
    content = '';
  if (mode === 'stickers') {
    const s = stickerSheets(p as StickerProject)[args.sheet];
    if (!s) throw Error('Sheet not found.');
    w = s.width;
    h = s.height;
    const artwork = await renderStickerSheet(s, p as StickerProject, { maxPixels: args.maxPixels });
    content = `<image href="data:image/png;base64,${bytesToBase64(artwork)}" width="${w}" height="${h}"/>`;
    for (const a of args.showCuts ? s.placements : []) {
      const art = (p as StickerProject).artwork.find(
        (v) => v.id === (p as StickerProject).items[a.itemIndex],
      )!;
      const q = a.sticker;
      const cuts = art.design
        ? stickerLocalCuts(
            art.design,
            { ...q, flipX: false, flipY: false },
            (p as StickerProject).settings.fit,
          )
            .map(
              (cut) =>
                `<path d="${pathSvg(cut)}" fill="none" stroke="#ec268f" stroke-width=".15" stroke-dasharray=".8 .6"/>`,
            )
            .join('')
        : `<rect width="${q.width}" height="${q.height}" rx="${q.radius}" fill="none" stroke="#ec268f" stroke-width=".15" stroke-dasharray=".8 .6"/>`;
      content += `<g transform="translate(${q.x + q.width / 2} ${q.y + q.height / 2}) rotate(${q.rotation}) scale(${q.flipX ? -1 : 1} ${q.flipY ? -1 : 1}) translate(${-q.width / 2} ${-q.height / 2})">${cuts}</g>`;
    }
  } else {
    const c = p as Project,
      s = layout(c.entries, c.settings)[args.sheet];
    if (!s) throw Error('Sheet not found.');
    w = s.width;
    h = s.height;
    const images = new Map(
      await Promise.all(
        [...new Set(s.placements.map((a) => a.entry.card.faces[a.entry.face].image))].map(
          async (url) =>
            [url, url.startsWith('data:') ? url : await pngFromImage(url, args.maxPixels)] as const,
        ),
      ),
    );
    for (const a of s.placements) {
      const f = a.entry.card.faces[a.entry.face];
      content += `<g transform="translate(${a.x + a.width / 2} ${a.y + a.height / 2}) rotate(${a.rotated ? 90 : 0})"><image href="${xml(images.get(f.image)!)}" x="${-c.settings.width / 2}" y="${-c.settings.height / 2}" width="${c.settings.width}" height="${c.settings.height}"/>${args.showCuts ? `<rect x="${-c.settings.width / 2}" y="${-c.settings.height / 2}" width="${c.settings.width}" height="${c.settings.height}" rx="${c.settings.radius}" fill="none" stroke="#ec268f" stroke-width=".15" stroke-dasharray=".8 .6"/>` : ''}</g>`;
    }
  }
  return pngFromSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/>${content}</svg>`,
    args.maxPixels,
  );
}
export async function invokeAiDesign(name: string, input: unknown): Promise<any> {
  const epoch = requestEpoch,
    signal = requestController.signal;
  const args = designTool(name).schema.parse(input);
  if (name === 'get_design_capabilities') return AI_DESIGN_GUIDE;
  const mode: AiMode =
    name.includes('sticker_items') || name === 'arrange_stickers'
      ? 'stickers'
      : ['edit_card_entries', 'search_cards', 'add_catalog_cards'].includes(name)
        ? 'cards'
        : args.workspace;
  const c = ws(mode),
    before = c.read();
  let next = clone(before),
    result: any = {};
  const assertCurrent = () => {
    if (epoch !== requestEpoch) throw Error('AI design access has stopped.');
    if (c.busy()) throw Error('Finish the current editor operation before AI edits.');
    if (workspaces.get(mode) !== c || c.read() !== before)
      throw Error('The project changed while AI was working. Read the workspace and retry.');
  };
  const save = async () => {
    assertCurrent();
    const clean = validate(mode, next);
    const fresh = ['create_project', 'load_project'].includes(name);
    if (fresh && c.beforeReplace) {
      await c.beforeReplace();
      assertCurrent();
    }
    c.write(clean, fresh);
    c.open(fresh);
    return result;
  };
  if (name === 'search_cards') return searchCards(args.query);
  if (name === 'add_catalog_cards') {
    const cards = await resolveCardIds(args.ids);
    (next as Project).entries.push(
      ...cards.map((card) => ({ id: crypto.randomUUID(), quantity: args.quantity, face: 0, card })),
    );
    result = { added: cards.length };
    return save();
  }
  if (name === 'manage_design') {
    const id = crypto.randomUUID();
    if (mode === 'cards') {
      const p = next as Project,
        entry = p.entries.find((e) => e.id === args.designId);
      if (!entry) throw Error('Card entry not found.');
      if (args.action === 'delete') p.entries = p.entries.filter((e) => e.id !== entry.id);
      else {
        if (args.copies < 1) throw Error('Cards need at least one copy.');
        p.entries.push({
          ...clone(entry),
          id,
          quantity: args.copies,
          card: { ...clone(entry.card), name: args.name || `${entry.card.name} copy` },
        });
      }
    } else {
      let p = next as StickerProject;
      const a = p.artwork.find((a) => a.id === args.designId);
      if (!a) throw Error('Sticker design not found.');
      if (args.action === 'delete') {
        p = removeStickers(
          p,
          p.items.flatMap((item, i) => (item === a.id ? [i] : [])),
        );
        p.artwork = p.artwork.filter((v) => v.id !== a.id);
      } else {
        p.artwork.push({ ...clone(a), id, name: args.name || `${a.name} copy` });
        for (let i = 0; i < args.copies; i++) p = appendSticker(p, id);
      }
      next = p;
    }
    result = args.action === 'duplicate' ? { designId: id } : {};
    return save();
  }
  if (name === 'get_workspace')
    return JSON.parse(
      JSON.stringify(before, (key, v) =>
        !args.includeImages && ['image', 'preview', 'pdf'].includes(key) && typeof v === 'string'
          ? `[image omitted: ${v.length} characters]`
          : v,
      ),
    );
  if (name === 'export_project')
    return {
      filename: `${before.name.replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 60) || 'project'}.${mode}.criprox.json`,
      project: before,
    };
  if (name === 'preview_design') return { image: await previewAiProject(mode, before, args) };
  if (name === 'workspace_history') {
    c[args.action as 'undo' | 'redo']();
    c.open();
    return { ok: true };
  }
  if (name === 'create_project') {
    next =
      mode === 'cards'
        ? { version: 1, name: args.name, entries: [], settings: clone(DEFAULT_SETTINGS) }
        : { ...newStickerProject(), name: args.name };
    return save();
  }
  if (name === 'load_project') {
    next = validate(mode, args.project as AiProject);
    return save();
  }
  if (name === 'update_project_settings') {
    const patch = { ...args.settings };
    if (mode === 'stickers') {
      const s = next as StickerProject;
      if (patch.profile) throw Error('Card profiles do not apply to sticker projects.');
      if (patch.machine) {
        if (patch.machine === 'manual')
          throw Error('Stickers require a registration-capable machine guide.');
        if (s.machine !== patch.machine) s.capture = undefined;
        s.machine = patch.machine;
        delete patch.machine;
      }
      next = changeStickerSettings(s, { ...s.settings, ...patch });
    } else {
      const allowed = ['width', 'height', 'gap', 'radius', 'paper', 'profile', 'machine', 'dpi'];
      if (Object.keys(patch).some((k) => !allowed.includes(k)))
        throw Error('Unsupported card sheet setting.');
      (next as Project).settings = { ...(next as Project).settings, ...patch };
    }
    return save();
  }
  if (name === 'edit_sticker_items') {
    let s = next as StickerProject;
    const i = args.index;
    if (args.action === 'add') {
      if (!args.designId) throw Error('Choose designId.');
      for (let n = 0; n < args.copies; n++) {
        s = appendSticker(
          s,
          args.designId,
          args.pose?.width && args.pose?.height ? args.pose : undefined,
        );
        if (args.pose) s = editSticker(s, s.items.length - 1, args.pose);
      }
    } else {
      if (i === undefined || i >= s.items.length) throw Error('Choose an existing sticker index.');
      s =
        args.action === 'delete'
          ? removeStickers(s, [i])
          : args.action === 'duplicate'
            ? duplicateSticker(s, i)
            : editSticker(s, i, args.pose || {});
    }
    next = s;
    return save();
  }
  if (name === 'edit_card_entries') {
    const p = next as Project,
      i = p.entries.findIndex((e) => e.id === args.entryId);
    if (i < 0) throw Error('Card entry not found.');
    if (args.action === 'delete') p.entries.splice(i, 1);
    else if (args.action === 'duplicate')
      p.entries.splice(i + 1, 0, { ...clone(p.entries[i]), id: crypto.randomUUID() });
    else if (args.action === 'quantity') {
      if (!args.quantity) throw Error('Provide quantity.');
      p.entries[i].quantity = args.quantity;
    } else {
      if (args.face === undefined) throw Error('Provide face.');
      p.entries[i].face = args.face;
    }
    return save();
  }
  if (name === 'arrange_stickers') {
    next = (
      await runStickerLayout(next as StickerProject, args.action, {
        selected: args.designId,
        signal,
        progress: () => {},
      })
    ).project;
    return save();
  }
  const id = args.designId || crypto.randomUUID();
  let d: StickerDesign,
    designName = args.name;
  if (name === 'create_design') {
    const size = mode === 'cards' ? (next as Project).settings : (next as StickerProject).settings;
    d = args.hero
      ? heroDesign(size.width, size.height, args.hero)
      : newDesign(args.canvas?.width || size.width, args.canvas?.height || size.height);
    Object.assign(d, args.canvas || {});
    d = applyDesignOperations(
      d,
      (args.elements || []).map((element: any) => ({ action: 'add', element })),
    );
  } else if (name === 'import_artwork') {
    let image = args.image;
    if (args.svg) {
      const imported = await importStickerSvg(
        new File([args.svg], 'ai-artwork.svg', { type: 'image/svg+xml' }),
      );
      image = imported[0].image;
    }
    const size = mode === 'cards' ? (next as Project).settings : (next as StickerProject).settings;
    d = newDesign(size.width, size.height);
    d.elements = [
      { ...newElement('image', d), x: 0, y: 0, width: d.width, height: d.height, image },
    ];
  } else {
    const a = findDesign(mode, next, id);
    designName ??= a.name;
    d = a.design
      ? clone(a.design)
      : newDesign(
          mode === 'cards'
            ? (next as Project).settings.width
            : (next as StickerProject).settings.width,
          mode === 'cards'
            ? (next as Project).settings.height
            : (next as StickerProject).settings.height,
        );
    if (!a.design) {
      const image = a.image.startsWith('data:') ? a.image : await pngFromImage(a.image, 4096);
      d.elements = [
        { ...newElement('image', d), x: 0, y: 0, width: d.width, height: d.height, image },
      ];
    }
    d =
      name === 'fit_design_cut'
        ? await fitDesignCut(d, args)
        : applyDesignOperations(d, args.operations, args.canvas);
  }
  if (
    mode === 'cards' &&
    (d.width !== (next as Project).settings.width || d.height !== (next as Project).settings.height)
  )
    throw Error('Card canvases must match the project card dimensions.');
  next = await storeDesign(
    mode,
    next,
    id,
    designName,
    d,
    name === 'create_design' || name === 'import_artwork' ? args.copies : 0,
  );
  result = { designId: id, name: designName, layers: d.elements.length };
  return save();
}
