export type CallMode = 'voice' | 'video';
export type CallPhase = 'ringing' | 'connected' | 'ended';

/** The fake connection takes about one ring before it reports connected. */
export const CALL_RING_MS = 1200;
/** One whole second per tick, so the elapsed clock matches what the reader sees. */
export const CALL_TICK_MS = 1000;

export interface CallState {
  mode: CallMode;
  phase: CallPhase;
  /** Whole seconds connected; zero while ringing so the timer cannot start early. */
  seconds: number;
  muted: boolean;
  speaker: boolean;
  camera: boolean;
}

export function createCall(mode: CallMode): CallState {
  return { mode, phase: 'ringing', seconds: 0, muted: false, speaker: true, camera: mode === 'video' };
}

export function connectCall(state: CallState): CallState {
  return state.phase === 'ringing' ? { ...state, phase: 'connected' } : state;
}

/** A tick only advances once connected; ringing time is not call time. */
export function tickCall(state: CallState): CallState {
  return state.phase === 'connected' ? { ...state, seconds: state.seconds + 1 } : state;
}

export function endCall(state: CallState): CallState {
  return state.phase === 'ended' ? state : { ...state, phase: 'ended' };
}

export function toggleCallFlag(state: CallState, flag: 'muted' | 'speaker' | 'camera'): CallState {
  if (flag === 'camera' && state.mode !== 'video') return state;
  return { ...state, [flag]: !state[flag] };
}

export function formatCallDuration(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function callStatusLabel(state: CallState): string {
  if (state.phase === 'ringing') return 'Đang đổ chuông';
  if (state.phase === 'ended') return `Đã kết thúc · ${formatCallDuration(state.seconds)}`;
  return formatCallDuration(state.seconds);
}
