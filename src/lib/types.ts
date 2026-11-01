import { DEFAULT_CUT_SETTINGS, type CutSettings } from './cut-settings';
import type { StickerDesign } from './sticker-design';
export type CardFace = {
  name: string;
  image: string;
  preview: string;
  /** Editable artwork shared with the sticker designer and AI design tools. */
  design?: StickerDesign;
  /** Source-specific trim geometry applied before fitting the finished card. */
  trim?: 'mpc';
};
export const PRINT_DPI_OPTIONS = [300, 600, 900, 1200] as const;
export const STANDARD_CARD_RADIUS_MM = 2.5;
export const BACK_OUTER_BLEED_MM = 1.5;
export type PrintDpi = (typeof PRINT_DPI_OPTIONS)[number];
export type Card = {
  id: string;
  name: string;
  kind?: 'token';
  set: string;
  setName: string;
  collector: string;
  faces: CardFace[];
  oracleId?: string;
  demo?: boolean;
};
export type Entry = { id: string; card: Card; quantity: number; face: number };
export type Settings = CutSettings & {
  units: 'mm' | 'in';
  paper: 'letter' | 'a4';
  machine: 'maker' | 'explore-5' | 'explore' | 'joy-xtra' | 'manual';
  profile: 'expanded' | 'seven' | 'eight' | 'nine';
  width: number;
  height: number;
  gap: number;
  radius: number;
  bleed: number;
  backBleedEnabled: boolean;
  backsEnabled: boolean;
  backPrintMode: 'manual' | 'duplex';
  backFlip: 'long-edge' | 'short-edge';
  backRotation: 0 | 180;
  backOffsetX: number;
  backOffsetY: number;
  /** Desired physical cut correction relative to the printed artwork. Positive is right/down. */
  manualCutCorrectionX: number;
  manualCutCorrectionY: number;
  manualGuidesEnabled: boolean;
  manualGuideColor: string;
  manualGuidePageColor: string;
  /** CSS pixels at 96 DPI, so physical line width stays fixed across export DPI choices. */
  manualGuideWidthPx: number;
  manualGuidePlacement: 'outside' | 'center' | 'inside';
  manualGuideCardStyle: 'none' | 'corners' | 'full';
  manualGuideLineStyle: 'solid' | 'dashed';
  manualGuideCornerStyle: 'square' | 'round';
  manualGuideLengthMm: number;
  manualGuidePageStyle: 'none' | 'edge' | 'full';
  dpi: PrintDpi;
  upscaleScryfall: boolean;
  upscaleBackend: 'built-in' | 'upscayl';
  proxyLabel: boolean;
};
export const isTightRegisteredProfile = (profile: Settings['profile']) => profile === 'seven';
export const fixedBleedMm = (settings: Pick<Settings, 'profile'>) =>
  isTightRegisteredProfile(settings.profile) ? 0.05 : 0.5;
export const frontBleedMm = (settings: Pick<Settings, 'profile' | 'bleed'>) =>
  settings.bleed > 0 ? fixedBleedMm(settings) : 0;
export const backBleedMm = (settings: Pick<Settings, 'profile' | 'backBleedEnabled'>) =>
  settings.backBleedEnabled ? fixedBleedMm(settings) : 0;
export const backOuterBleedMm = (settings: Pick<Settings, 'backBleedEnabled'>) =>
  settings.backBleedEnabled ? BACK_OUTER_BLEED_MM : 0;
export type Project = {
  version: 1;
  name: string;
  entries: Entry[];
  settings: Settings;
  backArtwork?: CardFace;
};
export const DEFAULT_SETTINGS: Settings = {
  ...DEFAULT_CUT_SETTINGS,
  units: 'in',
  paper: 'letter',
  machine: 'maker',
  profile: 'expanded',
  width: 63,
  height: 88,
  gap: 1,
  radius: STANDARD_CARD_RADIUS_MM,
  bleed: 0.5,
  backBleedEnabled: true,
  backsEnabled: false,
  backPrintMode: 'manual',
  backFlip: 'long-edge',
  backRotation: 180,
  backOffsetX: 0,
  backOffsetY: 0,
  manualCutCorrectionX: 0,
  manualCutCorrectionY: 0,
  manualGuidesEnabled: true,
  manualGuideColor: '#222222',
  manualGuidePageColor: '#555555',
  manualGuideWidthPx: 1,
  manualGuidePlacement: 'outside',
  manualGuideCardStyle: 'none',
  manualGuideLineStyle: 'solid',
  manualGuideCornerStyle: 'square',
  manualGuideLengthMm: 7.5,
  manualGuidePageStyle: 'edge',
  dpi: 300,
  upscaleScryfall: false,
  upscaleBackend: 'built-in',
  proxyLabel: false,
};
export const EMPTY_PROJECT: Project = {
  version: 1,
  name: 'Untitled deck',
  entries: [],
  settings: DEFAULT_SETTINGS,
};
