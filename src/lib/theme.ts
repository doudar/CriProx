import { readLocalSetting } from './storage';
export type ColorTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'skarix-color-theme';

export function getInitialColorTheme(): ColorTheme {
  try {
    const saved = readLocalSetting(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Storage can be unavailable in a locked-down browser context.
  }

  return 'light';
}

export function applyColorTheme(theme: ColorTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#121217' : '#f6f7f9');
}

export function saveColorTheme(theme: ColorTheme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The active theme still applies for this session when storage is unavailable.
  }
}
