export interface Preferences { theme: 'dark' | 'light'; glass: number; motion: boolean; lowBlur: boolean }
export const PREFS_KEY = 'zalo-glass-prototype-prefs';
export const defaults: Preferences = { theme: 'dark', glass: 68, motion: true, lowBlur: false };
export function parsePreferences(raw: string | null): Preferences {
  try {
    const p = JSON.parse(raw ?? '{}');
    if (!p || typeof p !== 'object') return { ...defaults };
    return {
      theme: p.theme === 'light' ? 'light' : 'dark',
      glass: typeof p.glass === 'number' && Number.isFinite(p.glass) ? Math.max(15, Math.min(95, p.glass)) : 68,
      motion: p.motion !== false, lowBlur: p.lowBlur === true,
    };
  } catch { return { ...defaults }; }
}
export function serializePreferences(prefs: Preferences): string {
  return JSON.stringify({ theme: prefs.theme, glass: prefs.glass, motion: prefs.motion, lowBlur: prefs.lowBlur });
}
