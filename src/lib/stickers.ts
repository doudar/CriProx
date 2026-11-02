import { stickerFootprint, footprintsConflict, nestingCandidates } from './sticker-nesting';
import { designOutputBounds } from './sticker-contours';
import { isMachine, machineGuide, outsidePlanningGuide } from './machine-guides';
import { validateStickerDesign, type StickerDesign } from './sticker-design';
import { designCutPaths, hasCustomCuts } from './sticker-cuts';
import { DEFAULT_SETTINGS, type Settings, type Entry } from './types';
import type { Sheet, Placement } from './layout';
import { registrationKey } from './registration';
import { DEFAULT_CUT_SETTINGS, readCutSettings, type CutSettings } from './cut-settings';

export type StickerSettings = CutSettings & {
  layout: 'grid' | 'tapered';
  areaWidth: number;
  areaHeight: number;
  paper: 'letter' | 'a4';
  width: number;
  height: number;
  gap: number;
  radius: number;
  fit: 'contain' | 'cover';
  borderWidth?: number;
  borderStrokeWidth?: number;
  borderStrokeColor?: string;
  dpi: 300 | 600;
};
export type StickerArtwork = { id: string; name: string; image: string; design?: StickerDesign };
export type StickerPose = {
  sheet: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  radius: number;
};
export type StickerSheet = Omit<Sheet, 'placements'> & {
  placements: (Placement & { sticker: StickerPose; itemIndex: number })[];
};
export type StickerProject = {
  kind: 'skarix-stickers';
  version: 1 | 2;
  machine: Exclude<Settings['machine'], 'manual'>;
  name: string;
  settings: StickerSettings;
  artwork: StickerArtwork[];
  items: string[];
  poses?: StickerPose[];
  capture?: { key: string; name: string; pdf: string };
};
export const MAX_STICKER_FILE_BYTES = 90_000_000;
export const MAX_STICKERS = 500;
export function newStickerProject(): StickerProject {
  return {
    kind: 'skarix-stickers',
    version: 1,
    machine: 'explore-5',
    name: 'Untitled design',
    settings: {
      ...DEFAULT_CUT_SETTINGS,
      layout: 'grid',
      areaWidth: 180,
      areaHeight: 220,
      paper: 'letter',
      width: 40,
      height: 40,
      gap: 2,
      radius: 3,
      fit: 'contain',
      borderWidth: 0,
      borderStrokeWidth: 0,
      borderStrokeColor: '#222222',
      dpi: 300,
    },
    artwork: [],
    items: [],
  };
}

/** Reuse the measured capture and layout engine; keep sticker files separate from card projects. */
export function stickerLayoutSettings(
  settings: StickerSettings,
  machine: StickerProject['machine'] = 'explore-5',
): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    machine: machine === 'explore-5' ? 'explore' : machine,
    profile: 'expanded',
    units: 'mm',
    bleed: 0,
    backsEnabled: false,
    proxyLabel: false,
  };
}
export function stickerGeometryKey(
  settings: StickerSettings,
  machine: StickerProject['machine'] = 'explore-5',
): string {
  return `stickers-${machine}:${JSON.stringify([settings.layout, settings.areaWidth, settings.areaHeight])}:${registrationKey(stickerLayoutSettings(settings, machine))}`;
}
export function stickerTemplate(s: StickerSettings): Sheet {
  const options = [false, true]
    .map((rotated) => {
      const w = rotated ? s.height : s.width,
        h = rotated ? s.width : s.height;
      const columns = Math.floor((s.areaWidth + s.gap) / (w + s.gap));
      const rows = Math.floor((s.areaHeight + s.gap) / (h + s.gap));
      if (columns < 1 || rows < 1 || (s.layout === 'tapered' && (columns < 3 || rows < 5)))
        return null;
      const width = columns * w + (columns - 1) * s.gap,
        height = rows * h + (rows - 1) * s.gap;
      const placements: Sheet['placements'] = [];
      const entry: Entry = {
        id: 'slot',
        quantity: 1,
        face: 0,
        card: {
          id: 'slot',
          name: 'Sticker',
          set: 'local',
          setName: 'Stickers',
          collector: '',
          faces: [],
        },
      };
      for (let row = 0; row < rows; row++) {
        const inset = s.layout === 'tapered' ? Math.max(0, 2 - Math.min(row, rows - 1 - row)) : 0;
        const count = columns - inset,
          left = (inset * (w + s.gap)) / 2;
        for (let col = 0; col < count; col++)
          placements.push({
            entry,
            copy: placements.length,
            x: left + col * (w + s.gap),
            y: row * (h + s.gap),
            width: w,
            height: h,
            rotated,
          });
      }
      return { index: 0, width, height, placements };
    })
    .filter((option): option is Sheet => option !== null);
  const best = options.sort((a, b) => b.placements.length - a.placements.length)[0];
  if (!best)
    throw new Error(
      'These stickers do not fit this layout. Tapered sheets need at least three columns and five rows.',
    );
  return best;
}
export function validateStickerSettings(value: unknown): StickerSettings {
  const s = value as StickerSettings;
  if (
    !s ||
    !['grid', 'tapered'].includes(s.layout) ||
    !['letter', 'a4'].includes(s.paper) ||
    !['contain', 'cover'].includes(s.fit) ||
    ![300, 600].includes(s.dpi)
  )
    throw new Error('Invalid sticker sheet settings.');
  for (const [n, min, max] of [
    [s.areaWidth, 20, 190],
    [s.areaHeight, 20, s.paper === 'letter' ? 250 : 265],
    [s.width, 10, 180],
    [s.height, 10, 250],
    [s.gap, 1, 10],
    [s.radius, 0, Math.min(s.width, s.height) / 2],
    [s.borderWidth ?? 0, 0, 20],
    [s.borderStrokeWidth ?? 0, 0, 5],
  ]) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
      throw new Error(
        'Use sticker dimensions from 10 mm that fit the sheet, spacing from 1–10 mm, and a corner radius up to half the shorter side.',
      );
  }
  const capacity = stickerTemplate(s).placements.length;
  if (!/^#[0-9a-f]{6}$/i.test(s.borderStrokeColor ?? '#222222'))
    throw Error('Choose a valid border stroke color.');
  if (capacity < 1 || capacity > 500) throw new Error('These stickers do not fit the sheet.');
  return {
    layout: s.layout,
    ...readCutSettings(s),
    areaWidth: s.areaWidth,
    areaHeight: s.areaHeight,
    paper: s.paper,
    width: s.width,
    height: s.height,
    gap: s.gap,
    radius: s.radius,
    fit: s.fit,
    borderWidth: s.borderWidth ?? 0,
    borderStrokeWidth: s.borderStrokeWidth ?? 0,
    borderStrokeColor: s.borderStrokeColor ?? '#222222',
    dpi: s.dpi,
  };
}
const base64Image = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export function validateStickerProject(value: unknown): StickerProject {
  const p = value as StickerProject;
  if (
    !p ||
    !['skarix-stickers', 'criprox-stickers'].includes(p.kind) ||
    ![1, 2].includes(p.version) ||
    !isMachine(p.machine) ||
    (p.machine as string) === 'manual' ||
    typeof p.name !== 'string' ||
    p.name.length > 100 ||
    !Array.isArray(p.artwork) ||
    p.artwork.length > 500 ||
    !Array.isArray(p.items) ||
    p.items.length > MAX_STICKERS
  )
    throw new Error('This is not a supported Skarix sticker project.');
  const settings = validateStickerSettings(p.settings),
    ids = new Set<string>();
  let imageBytes = 0;
  const artwork = p.artwork.map((a) => {
    if (
      !a ||
      typeof a.id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(a.id) ||
      ids.has(a.id) ||
      typeof a.name !== 'string' ||
      a.name.length > 200 ||
      typeof a.image !== 'string' ||
      a.image.length > 14_000_000 ||
      !base64Image.test(a.image)
    )
      throw new Error('Sticker artwork must be an embedded PNG, JPEG, or WebP under 10 MB.');
    ids.add(a.id);
    imageBytes += a.image.length;
    const design = a.design === undefined ? undefined : validateStickerDesign(a.design);
    if (design) designCutPaths(design);
    if (design) imageBytes += design.elements.reduce((sum, e) => sum + (e.image?.length || 0), 0);
    return { id: a.id, name: a.name, image: a.image, ...(design ? { design } : {}) };
  });
  if (imageBytes > 50_000_000) throw new Error('Use less than 50 MB of embedded sticker artwork.');
  if (p.items.some((id) => typeof id !== 'string' || !ids.has(id)))
    throw new Error('The sticker sheet references missing artwork.');
  let poses: StickerPose[] | undefined;
  if (p.poses !== undefined) {
    if (p.version !== 2 || !Array.isArray(p.poses) || p.poses.length !== p.items.length)
      throw new Error('Invalid individual sticker placements.');
    poses = p.poses.map((pose) => validateStickerPose(pose, settings));
    if (p.capture) throw new Error('A freely arranged sheet needs a new Design Space print job.');
  }
  let capture: StickerProject['capture'];
  if (p.capture !== undefined) {
    if (artwork.some((a) => hasCustomCuts(a.design)))
      throw Error('Custom cut paths cannot use a captured rounded-rectangle template.');
    const c = p.capture;
    if (
      !c ||
      typeof c.key !== 'string' ||
      c.key !== stickerGeometryKey(settings, p.machine) ||
      typeof c.name !== 'string' ||
      c.name.length > 200 ||
      typeof c.pdf !== 'string' ||
      c.pdf.length > 33_333_336 ||
      !/^JVBERi0[A-Za-z0-9+/]*={0,2}$/.test(c.pdf)
    )
      throw new Error(
        'The saved registration PDF is invalid or belongs to different sticker geometry.',
      );
    capture = { key: c.key, name: c.name, pdf: c.pdf };
  }
  return {
    kind: 'skarix-stickers',
    version: p.version,
    machine: p.machine,
    name: p.name,
    settings,
    artwork,
    items: [...p.items],
    ...(poses ? { poses } : {}),
    ...(capture ? { capture } : {}),
  };
}
export function parseStickerProject(text: string): StickerProject {
  if (new TextEncoder().encode(text).byteLength > MAX_STICKER_FILE_BYTES)
    throw new Error('Sticker project exceeds 90 MB.');
  return validateStickerProject(JSON.parse(text));
}
export function stickerSheets(project: StickerProject): StickerSheet[] {
  const full = stickerTemplate(project.settings);
  const artwork = new Map(project.artwork.map((a) => [a.id, a]));
  const entries: Entry[] = project.items.map((id, i) => {
    const a = artwork.get(id);
    if (!a) throw new Error('Missing sticker artwork.');
    return {
      id: String(i),
      quantity: 1,
      face: 0,
      card: {
        id,
        name: a.name,
        set: 'local',
        setName: 'Stickers',
        collector: '',
        faces: [{ name: a.name, image: a.image, preview: a.image }],
      },
    };
  });
  const capacity = full.placements.length,
    sheets: StickerSheet[] = [];
  if (project.poses) {
    for (let page = 0; page <= Math.max(-1, ...project.poses.map((p) => p.sheet)); page++) {
      sheets.push({
        index: page,
        width: project.settings.areaWidth,
        height: project.settings.areaHeight,
        placements: project.poses.flatMap((pose, i) =>
          pose.sheet === page
            ? [
                {
                  ...stickerBounds(pose),
                  x: pose.x,
                  y: pose.y,
                  entry: entries[i],
                  copy: 0,
                  rotated: false,
                  sticker: pose,
                  itemIndex: i,
                },
              ]
            : [],
        ),
      });
    }
    return sheets;
  }
  for (let offset = 0; offset < entries.length; offset += capacity)
    sheets.push({
      ...full,
      index: sheets.length,
      placements: entries.slice(offset, offset + capacity).map((entry, i) => {
        const p = full.placements[i];
        return {
          ...p,
          entry,
          copy: 0,
          itemIndex: offset + i,
          sticker: {
            sheet: sheets.length,
            x: p.x,
            y: p.y,
            width: project.settings.width,
            height: project.settings.height,
            rotation: p.rotated ? 90 : 0,
            flipX: false,
            flipY: false,
            radius: project.settings.radius,
          },
        };
      }),
    });
  return sheets;
}
/** Fill the last sheet with one selected design or a repeating selection, preserving existing order. */
export function fillStickerSheet(
  project: StickerProject,
  selected?: string,
  options: StickerLayoutOptions = {},
): StickerProject {
  if (project.poses || !project.capture) return fillFreeStickerSheet(project, selected, options);
  const capacity = stickerTemplate(project.settings).placements.length;
  const pattern = selected ? [selected] : project.artwork.map((a) => a.id);
  if (!pattern.length || pattern.some((id) => !project.artwork.some((a) => a.id === id)))
    throw new Error('Add or select sticker artwork first.');
  const occupied = project.items.length % capacity;
  if (project.items.length && !occupied) return project;
  const count = capacity - occupied;
  if (project.items.length + count > MAX_STICKERS)
    throw new Error('Filling this sheet would exceed 500 stickers.');
  return {
    ...project,
    items: [
      ...project.items,
      ...Array.from({ length: count }, (_, i) => pattern[i % pattern.length]),
    ],
  };
}
export function changeStickerSettings(
  project: StickerProject,
  settings: StickerSettings,
): StickerProject {
  settings = validateStickerSettings(settings);
  return {
    ...project,
    settings,
    capture:
      stickerGeometryKey(settings, project.machine) ===
      stickerGeometryKey(project.settings, project.machine)
        ? project.capture
        : undefined,
    ...(project.poses ? { poses: project.poses.map((p) => validateStickerPose(p, settings)) } : {}),
  };
}

export function stickerBounds(p: Pick<StickerPose, 'width' | 'height' | 'rotation'>) {
  const a = (p.rotation * Math.PI) / 180,
    c = Math.abs(Math.cos(a)),
    s = Math.abs(Math.sin(a));
  return { width: p.width * c + p.height * s, height: p.width * s + p.height * c };
}
/** Use the same silhouettes as automatic placement, including contained shapes. */
export function hasStickerOverlap(project: StickerProject): boolean {
  const poses = stickerPoses(project);
  const footprints = poses.map((pose, i) =>
    stickerFootprint(
      project.artwork.find((a) => a.id === project.items[i]),
      pose,
      project.settings.fit,
    ),
  );
  return poses.some((p, i) =>
    poses.some(
      (q, j) =>
        j > i &&
        p.sheet === q.sheet &&
        footprintsConflict(footprints[i], p.x, p.y, footprints[j], q.x, q.y),
    ),
  );
}
function occupiedStickers(
  project: StickerProject,
  poses: StickerPose[],
  items: string[],
  sheet: number,
) {
  return poses.flatMap((pose, i) =>
    pose.sheet === sheet
      ? [
          {
            pose,
            footprint: stickerFootprint(
              project.artwork.find((a) => a.id === items[i]),
              pose,
              project.settings.fit,
            ),
          },
        ]
      : [],
  );
}
export function validateStickerPose(value: StickerPose, settings: StickerSettings): StickerPose {
  const p = value;
  if (
    !p ||
    !Number.isInteger(p.sheet) ||
    p.sheet < 0 ||
    p.sheet >= 24 ||
    typeof p.flipX !== 'boolean' ||
    typeof p.flipY !== 'boolean' ||
    [p.x, p.y, p.width, p.height, p.rotation, p.radius].some(
      (v) => typeof v !== 'number' || !Number.isFinite(v),
    ) ||
    p.width < 1 ||
    p.height < 1 ||
    p.radius < 0 ||
    p.radius > Math.min(p.width, p.height) / 2
  )
    throw new Error('Use finite sticker dimensions of at least 1 mm and a valid corner radius.');
  const rotation = ((p.rotation % 360) + 360) % 360;
  const b = stickerBounds({ ...p, rotation });
  if (
    p.x < -1e-7 ||
    p.y < -1e-7 ||
    p.x + b.width > settings.areaWidth + 1e-7 ||
    p.y + b.height > settings.areaHeight + 1e-7
  )
    throw new Error('The sticker must fit inside the sheet, including its rotation.');
  return {
    sheet: p.sheet,
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
    rotation,
    flipX: p.flipX,
    flipY: p.flipY,
    radius: p.radius,
  };
}
export function stickerPoses(project: StickerProject): StickerPose[] {
  return project.poses ?? stickerSheets(project).flatMap((s) => s.placements.map((p) => p.sticker));
}
export function editSticker(
  project: StickerProject,
  index: number,
  patch: Partial<StickerPose>,
): StickerProject {
  const poses = stickerPoses(project).map((p) => ({ ...p }));
  if (!poses[index]) throw new Error('Select a sticker first.');
  const next = { ...poses[index], ...patch };
  next.radius = Math.min(next.radius, next.width / 2, next.height / 2);
  poses[index] = validateStickerPose(next, project.settings);
  return { ...project, version: 2, poses, capture: undefined };
}
export function removeStickers(project: StickerProject, indices: number[]): StickerProject {
  const removed = new Set(indices);
  const remaining = project.poses?.filter((_, i) => !removed.has(i));
  const pages = [...new Set(remaining?.map((p) => p.sheet))].sort((a, b) => a - b);
  return {
    ...project,
    items: project.items.filter((_, i) => !removed.has(i)),
    ...(remaining
      ? {
          poses: remaining.map((p) => ({ ...p, sheet: pages.indexOf(p.sheet) })),
          capture: undefined,
        }
      : {}),
  };
}
/** Search in layout coordinates, translating the same machine guides shown in the editor. */
function stickerSpot(
  project: StickerProject,
  pose: StickerPose,
  id: string,
  occupied: ReturnType<typeof occupiedStickers>,
  nest = true,
  deadline = Infinity,
) {
  const s = project.settings,
    guide = machineGuide(project.machine, s.paper);
  const left = (guide.page.width - s.areaWidth) / 2,
    top = (guide.page.height - s.areaHeight) / 2;
  const b = stickerFootprint(
    project.artwork.find((a) => a.id === id),
    pose,
    s.fit,
  );
  const minX = Math.max(0, guide.bounds.x - left),
    minY = Math.max(0, guide.bounds.y - top);
  // Corner edges are candidates too: otherwise an empty sheet can have no valid starting point.
  const xs = [
    ...new Set([
      minX,
      ...guide.corners.map((c) => c.x + c.width - left),
      ...occupied.map(({ pose: p, footprint: f }) => p.x + f.width + s.gap),
    ]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      minY,
      ...guide.corners.map((c) => c.y + c.height - top),
      ...occupied.map(({ pose: p, footprint: f }) => p.y + f.height + s.gap),
    ]),
  ].sort((a, b) => a - b);
  const candidates = [
    ...ys.flatMap((y) => xs.map((x) => ({ x, y }))),
    ...(nest ? nestingCandidates(b, occupied, s.gap) : []),
  ]
    .filter(
      (p) =>
        p.x >= minX - 1e-7 &&
        p.y >= minY - 1e-7 &&
        p.x + b.width <= s.areaWidth + 1e-7 &&
        p.y + b.height <= s.areaHeight + 1e-7,
    )
    .sort((a, b) => (Math.abs(a.y - b.y) < 1e-6 ? a.x - b.x : a.y - b.y));
  const tried = new Set<string>();
  for (const candidate of candidates) {
    if (performance.now() > deadline) throw new NestingLimit();
    const x = Math.max(minX, candidate.x),
      y = Math.max(minY, candidate.y);
    const key = x.toFixed(6) + ',' + y.toFixed(6);
    if (tried.has(key)) continue;
    tried.add(key);
    if (
      x < minX - 1e-7 ||
      y < minY - 1e-7 ||
      x + b.width > s.areaWidth + 1e-7 ||
      y + b.height > s.areaHeight + 1e-7
    )
      continue;
    if (outsidePlanningGuide({ x: x + left, y: y + top, ...b }, guide)) continue;
    if (
      occupied.every((o) =>
        nest
          ? !footprintsConflict(b, x, y, o.footprint, o.pose.x, o.pose.y, s.gap)
          : x + b.width + s.gap <= o.pose.x + 1e-7 ||
            o.pose.x + o.footprint.width + s.gap <= x + 1e-7 ||
            y + b.height + s.gap <= o.pose.y + 1e-7 ||
            o.pose.y + o.footprint.height + s.gap <= y + 1e-7,
      )
    )
      return { x, y };
  }
  return undefined;
}
class NestingLimit extends Error {}
export type StickerLayoutOptions = {
  nestingBudgetMs?: number;
  progress?: (completed: number, total: number, phase: 'grid' | 'nesting') => void;
  limited?: () => void;
};
export function arrangeStickers(
  project: StickerProject,
  options: StickerLayoutOptions = {},
): StickerProject {
  const grid = arrangeWithStrategy(project, false, options);
  let nested: StickerProject;
  try {
    nested = arrangeWithStrategy(
      project,
      true,
      options,
      performance.now() + (options.nestingBudgetMs ?? 6000),
    );
  } catch (error) {
    if (!(error instanceof NestingLimit)) throw error;
    options.limited?.();
    return grid;
  }
  const score = (p: StickerProject) =>
    Math.max(0, ...p.poses!.map((p) => p.sheet)) * 1000 +
    Math.max(
      0,
      ...p
        .poses!.filter((q) => q.sheet === Math.max(0, ...p.poses!.map((r) => r.sheet)))
        .map((p) => p.y + stickerBounds(p).height),
    );
  return score(nested) <= score(grid) ? nested : grid;
}
function arrangeWithStrategy(
  project: StickerProject,
  nest: boolean,
  options: StickerLayoutOptions = {},
  deadline = Infinity,
): StickerProject {
  const poses: StickerPose[] = [];
  let sheet = 0;
  for (const [index, original] of stickerPoses(project).entries()) {
    if (performance.now() > deadline) throw new NestingLimit();
    options.progress?.(index, project.items.length, nest ? 'nesting' : 'grid');
    const id = project.items[index];
    if (!stickerSpot(project, original, id, []))
      throw new Error(
        'A sticker cannot fit clear of the machine guides. Resize it or change the paper/layout limits.',
      );
    let spot = stickerSpot(
      project,
      original,
      id,
      occupiedStickers(project, poses, project.items, sheet),
      nest,
      deadline,
    );
    if (!spot) {
      sheet++;
      if (sheet >= 24) throw new Error('Use at most 24 sheets per project.');
      spot = stickerSpot(project, original, id, [])!;
    }
    poses.push({ ...original, ...spot, sheet });
  }
  return { ...project, version: 2, poses, capture: undefined };
}
export function duplicateSticker(project: StickerProject, index: number): StickerProject {
  if (project.items.length >= MAX_STICKERS) throw new Error('Use at most 500 stickers.');
  const poses = stickerPoses(project),
    pose = poses[index];
  if (!pose) throw new Error('Select a sticker first.');
  const b = stickerBounds(pose);
  return {
    ...project,
    version: 2,
    items: [...project.items, project.items[index]],
    capture: undefined,
    poses: [
      ...poses,
      {
        ...pose,
        x: Math.min(pose.x + 3, project.settings.areaWidth - b.width),
        y: Math.min(pose.y + 3, project.settings.areaHeight - b.height),
      },
    ],
  };
}
function fillFreeStickerSheet(
  project: StickerProject,
  selected?: string,
  options: StickerLayoutOptions = {},
): StickerProject {
  const grid = fillWithStrategy(project, selected, false, options);
  let nested: StickerProject;
  try {
    nested = fillWithStrategy(
      project,
      selected,
      true,
      options,
      performance.now() + (options.nestingBudgetMs ?? 6000),
    );
  } catch (error) {
    if (!(error instanceof NestingLimit)) throw error;
    options.limited?.();
    return grid;
  }
  return nested.items.length >= grid.items.length ? nested : grid;
}
function fillWithStrategy(
  project: StickerProject,
  selected: string | undefined,
  nest: boolean,
  options: StickerLayoutOptions = {},
  deadline = Infinity,
): StickerProject {
  const poses = stickerPoses(project).map((p) => ({ ...p })),
    items = [...project.items];
  const pattern = selected ? [selected] : project.artwork.map((a) => a.id);
  if (!pattern.length || pattern.some((id) => !project.artwork.some((a) => a.id === id)))
    throw new Error('Add or select artwork first.');
  const sheet = Math.max(0, ...poses.map((p) => p.sheet)),
    s = project.settings;
  let next = 0,
    misses = 0,
    added = 0;
  // A deterministic gap-aware placement search preserves existing manual positions.
  while (items.length < MAX_STICKERS) {
    if (performance.now() > deadline) throw new NestingLimit();
    options.progress?.(items.length, MAX_STICKERS, nest ? 'nesting' : 'grid');
    const id = pattern[next % pattern.length],
      original = poses[project.items.indexOf(id)];
    const design = project.artwork.find((a) => a.id === id)?.design;
    const size = design ? designOutputBounds(design) : s;
    const p: StickerPose = original
      ? { ...original, sheet }
      : {
          sheet,
          x: 0,
          y: 0,
          width: size.width,
          height: size.height,
          rotation: 0,
          flipX: false,
          flipY: false,
          radius: Math.min(s.radius, size.width / 2, size.height / 2),
        };
    const spot = stickerSpot(
      project,
      p,
      id,
      occupiedStickers(project, poses, items, sheet),
      nest,
      deadline,
    );
    if (!spot) {
      next++;
      if (++misses >= pattern.length) break;
      continue;
    }
    misses = 0;
    poses.push({ ...p, ...spot });
    items.push(id);
    next++;
    added++;
  }
  if (!added) return project;
  return { ...project, version: 2, items, poses, capture: undefined };
}

export function appendSticker(
  project: StickerProject,
  id: string,
  size?: { width: number; height: number },
): StickerProject {
  if (project.items.length >= MAX_STICKERS || !project.artwork.some((a) => a.id === id))
    throw new Error('Choose artwork and use at most 500 stickers.');
  const poses = stickerPoses(project),
    original = poses[project.items.indexOf(id)],
    s = project.settings;
  const design = project.artwork.find((a) => a.id === id)?.design;
  const natural = design ? designOutputBounds(design) : s;
  const pose: StickerPose = original
    ? { ...original }
    : {
        sheet: 0,
        x: 0,
        y: 0,
        width: size?.width ?? natural.width,
        height: size?.height ?? natural.height,
        rotation: 0,
        flipX: false,
        flipY: false,
        radius: s.radius,
      };
  if (size) {
    pose.width = size.width;
    pose.height = size.height;
  }
  pose.radius = Math.min(pose.radius, pose.width / 2, pose.height / 2);
  const b = stickerBounds(pose);
  if (b.width > s.areaWidth + 1e-7 || b.height > s.areaHeight + 1e-7)
    throw new Error('This sticker is larger than the sheet. Choose a smaller import size.');
  if (!stickerSpot(project, pose, id, []))
    throw new Error(
      'This sticker cannot fit clear of the machine guides. Choose a smaller size or different paper/layout limits.',
    );
  for (let page = Math.max(0, ...poses.map((p) => p.sheet)); page < 24; page++) {
    const spot = stickerSpot(
      project,
      pose,
      id,
      occupiedStickers(project, poses, project.items, page),
    );
    if (spot)
      return {
        ...project,
        version: 2,
        items: [...project.items, id],
        poses: [...poses, { ...pose, ...spot, sheet: page }],
        capture: undefined,
      };
  }
  throw new Error('Use at most 24 sheets per project.');
}
