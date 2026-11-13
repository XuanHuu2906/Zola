import type { MessageMention } from '../ipc-contract.js';

/** Validate mention offsets and retain only renderer-safe ranges (never user IDs). */
export function mentionRangesOf(value: unknown, text: string): MessageMention[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ranges = value.flatMap((item): MessageMention[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const body = item as Record<string, unknown>;
    const pos = body.pos;
    const len = body.len;
    if (typeof pos !== 'number' || typeof len !== 'number'
      || !Number.isSafeInteger(pos) || !Number.isSafeInteger(len)
      || pos < 0 || len <= 0 || pos + len > text.length) return [];
    return [{ pos, len }];
  }).sort((a, b) => a.pos - b.pos || a.len - b.len);
  const nonOverlapping: MessageMention[] = [];
  let end = 0;
  for (const range of ranges) {
    if (range.pos < end) continue;
    nonOverlapping.push(range);
    end = range.pos + range.len;
  }
  return nonOverlapping.length ? nonOverlapping : undefined;
}
