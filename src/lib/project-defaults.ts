import { validateProject } from './project';
import { availableSheetProfiles } from './paper-workflow';
import {
  DEFAULT_SETTINGS,
  fixedBleedMm,
  STANDARD_CARD_RADIUS_MM,
  type CardFace,
  type Project,
  type Settings,
} from './types';

export type ProjectDefaults = {
  version: 1;
  settings: Settings;
  backArtwork?: CardFace;
};

export const FACTORY_PROJECT_DEFAULTS: ProjectDefaults = {
  version: 1,
  settings: { ...DEFAULT_SETTINGS },
};

export function sheetSettingsMatch(a: Settings, b: Settings): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).every(
    (field) => a[field] === b[field],
  );
}

export function projectDefaultsMatch(a: ProjectDefaults, b: ProjectDefaults): boolean {
  return (
    sheetSettingsMatch(a.settings, b.settings) &&
    a.backArtwork?.name === b.backArtwork?.name &&
    a.backArtwork?.image === b.backArtwork?.image &&
    a.backArtwork?.preview === b.backArtwork?.preview &&
    a.backArtwork?.trim === b.backArtwork?.trim
  );
}

export type DefaultSettingsGroup = 'Sheet' | 'Print' | 'Card backs' | 'Cut guides' | 'Alignment';

export function defaultSettingsIssue(
  settings: Settings,
): { group: DefaultSettingsGroup; message: string } | undefined {
  const fields: [keyof Settings, string, number, number, DefaultSettingsGroup][] = [
    ['backOffsetX', 'Back alignment X', -5, 5, 'Alignment'],
    ['backOffsetY', 'Back alignment Y', -5, 5, 'Alignment'],
    ['manualCutCorrectionX', 'Manual cut correction X', -5, 5, 'Alignment'],
    ['manualCutCorrectionY', 'Manual cut correction Y', -5, 5, 'Alignment'],
  ];
  for (const [field, label, min, max, group] of fields) {
    const value = settings[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      return { group, message: `${label} must be between ${min} and ${max} mm.` };
  }
}

/** Keep dependent layout choices valid while editing defaults. */
export function updateDefaultSettings(settings: Settings, patch: Partial<Settings>): Settings {
  const next = { ...settings, ...patch };
  if (patch.machine || patch.paper || patch.profile) {
    if (!availableSheetProfiles(next).includes(next.profile))
      next.profile = next.machine === 'manual' ? 'nine' : 'expanded';
    if (next.profile !== 'expanded') {
      next.width = 63;
      next.height = 88;
      next.gap = next.profile === 'seven' ? 0.1 : 1;
      next.radius = STANDARD_CARD_RADIUS_MM;
    } else {
      next.gap = Math.max(1, next.gap);
    }
  }
  next.bleed = next.bleed > 0 ? fixedBleedMm(next) : 0;
  if (patch.backPrintMode && patch.backRotation === undefined)
    next.backRotation = patch.backPrintMode === 'manual' ? 180 : 0;
  return next;
}

export function withSheetSettingsDefaults(
  defaults: ProjectDefaults,
  source: Settings,
): ProjectDefaults {
  return { ...defaults, settings: { ...source } };
}

export type ManualGuideDefaults = Pick<
  Settings,
  | 'manualGuidesEnabled'
  | 'manualGuideColor'
  | 'manualGuidePageColor'
  | 'manualGuideWidthPx'
  | 'manualGuidePlacement'
  | 'manualGuideCardStyle'
  | 'manualGuideLineStyle'
  | 'manualGuideCornerStyle'
  | 'manualGuideLengthMm'
  | 'manualGuidePageStyle'
>;

export function manualGuideDefaultsFrom(settings: Settings): ManualGuideDefaults {
  return {
    manualGuidesEnabled: settings.manualGuidesEnabled,
    manualGuideColor: settings.manualGuideColor,
    manualGuidePageColor: settings.manualGuidePageColor,
    manualGuideWidthPx: settings.manualGuideWidthPx,
    manualGuidePlacement: settings.manualGuidePlacement,
    manualGuideCardStyle: settings.manualGuideCardStyle,
    manualGuideLineStyle: settings.manualGuideLineStyle,
    manualGuideCornerStyle: settings.manualGuideCornerStyle,
    manualGuideLengthMm: settings.manualGuideLengthMm,
    manualGuidePageStyle: settings.manualGuidePageStyle,
  };
}

export function manualGuideDefaultsMatch(a: Settings, b: Settings): boolean {
  const first = manualGuideDefaultsFrom(a),
    second = manualGuideDefaultsFrom(b);
  return Object.keys(first).every((key) => {
    const field = key as keyof ManualGuideDefaults;
    return field === 'manualGuideColor' || field === 'manualGuidePageColor'
      ? first[field].toLowerCase() === second[field].toLowerCase()
      : first[field] === second[field];
  });
}

export function withManualGuideDefaults(
  defaults: ProjectDefaults,
  source: Settings,
): ProjectDefaults {
  return {
    ...defaults,
    settings: { ...defaults.settings, ...manualGuideDefaultsFrom(source) },
  };
}

const copyFace = (face?: CardFace) => (face ? { ...face } : undefined);

export function projectDefaultsFrom(project: Pick<Project, 'settings' | 'backArtwork'>) {
  return {
    version: 1 as const,
    settings: { ...project.settings },
    backArtwork: copyFace(project.backArtwork),
  };
}

export function projectFromDefaults(defaults: ProjectDefaults): Project {
  return {
    version: 1,
    name: 'Untitled deck',
    entries: [],
    settings: { ...defaults.settings },
    backArtwork: copyFace(defaults.backArtwork),
  };
}

export function validateProjectDefaults(value: unknown): ProjectDefaults {
  const candidate = value as Partial<ProjectDefaults> | null;
  if (!candidate || candidate.version !== 1 || !candidate.settings)
    throw new Error('These are not supported Skarix project defaults.');

  const project = validateProject({
    version: 1,
    name: 'Project defaults',
    entries: [],
    settings: { ...candidate.settings },
    backArtwork: copyFace(candidate.backArtwork),
  });
  return projectDefaultsFrom(project);
}
