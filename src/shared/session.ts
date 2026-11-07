import type { Session } from '../renderer/adapters/types.ts';

/** Session-only storage: a demo sign-in dies with the window, not with history. */
export const SESSION_KEY = 'zalo-glass-session';
export const FALLBACK_LABEL = 'Người dùng Demo';

export function normalizeLabel(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
}

export function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { signedIn?: unknown; label?: unknown } | null;
    if (!value || typeof value !== 'object' || value.signedIn !== true) return null;
    return { signedIn: true, label: normalizeLabel(value.label) || FALLBACK_LABEL };
  } catch { return null; }
}

export function serializeSession(session: Session): string {
  return JSON.stringify({ signedIn: true, label: normalizeLabel(session.label) || FALLBACK_LABEL });
}
