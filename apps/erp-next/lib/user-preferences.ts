export type TextSizeOffset = 0 | 1 | 2 | 3 | 4;

export type BrowserUserPreferences = {
  textSizeOffset: TextSizeOffset;
};

export const defaultUserPreferences: BrowserUserPreferences = {
  textSizeOffset: 0,
};

function preferenceKey(userId: string) {
  return `demac.erp-next.user-preferences.${encodeURIComponent(userId)}.v1`;
}

export function normalizeTextSizeOffset(value: number): TextSizeOffset {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  return Math.max(0, Math.min(4, rounded)) as TextSizeOffset;
}

export function loadBrowserUserPreferences(userId: string): BrowserUserPreferences {
  if (typeof window === 'undefined') return defaultUserPreferences;
  try {
    const raw = window.localStorage.getItem(preferenceKey(userId));
    if (!raw) return defaultUserPreferences;
    const parsed = JSON.parse(raw) as Partial<BrowserUserPreferences>;
    return { textSizeOffset: normalizeTextSizeOffset(Number(parsed.textSizeOffset ?? 0)) };
  } catch {
    return defaultUserPreferences;
  }
}

export function saveBrowserUserPreferences(userId: string, preferences: BrowserUserPreferences) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(preferenceKey(userId), JSON.stringify({
      textSizeOffset: normalizeTextSizeOffset(preferences.textSizeOffset),
    }));
  } catch {
    // Personal accessibility preferences must never block the ERP UI.
  }
}
