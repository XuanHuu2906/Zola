import type { TransferKind } from '../renderer/adapters/types.ts';

/** One simulated network tick. Small enough to look alive, slow enough to read. */
export const TRANSFER_STEP_MS = 140;

export function transferStep(kind: TransferKind): number {
  return kind === 'upload' ? 13 : 18;
}

export function advanceProgress(current: number, kind: TransferKind): number {
  const start = Number.isFinite(current) ? current : 0;
  return Math.min(100, Math.max(0, start) + transferStep(kind));
}

export function clampProgress(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;
}

export function transferLabel(kind: TransferKind, progress: number): string {
  const percent = clampProgress(progress);
  if (percent >= 100) return kind === 'upload' ? 'Đã tải lên' : 'Đã tải xuống';
  return `${kind === 'upload' ? 'Đang tải lên' : 'Đang tải xuống'} ${percent}%`;
}

export function isTransferActive(progress: number | undefined): boolean {
  return typeof progress === 'number' && progress < 100;
}
