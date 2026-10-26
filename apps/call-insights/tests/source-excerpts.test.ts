import { describe, expect, it } from 'vitest';
import { verifiedExcerptSelection, type AuthorizedSegment } from '../server/investigations/sources';

function turn(segment_idx: number, start_seconds: number, end_seconds: number, is_masked = true): AuthorizedSegment {
  return { segment_idx, start_seconds, end_seconds, is_masked, text: `Turn ${segment_idx}.`, speaker_role: 'customer' };
}

describe('stable full-turn evidence selection', () => {
  it('expands through overlapping speakers until reopening yields exactly the saved selection', () => {
    const turns = [turn(1, 0, 4), turn(2, 3, 7), turn(3, 6, 10), turn(4, 10, 12)];
    const saved = verifiedExcerptSelection(turns, 1, 2);
    expect(saved).toEqual({ start: 0, end: 10, text: 'Turn 1. Turn 2. Turn 3.' });
    expect(verifiedExcerptSelection(turns, saved.start, saved.end)).toEqual(saved);
  });

  it('rejects an unmasked turn reached through a later overlapping expansion before evidence is saved', () => {
    expect(() => verifiedExcerptSelection([turn(1, 0, 4), turn(2, 3, 7), turn(3, 6, 10, false)], 1, 2)).toThrow(
      'fully masked'
    );
  });

  it('enforces the ten-minute cap after all overlapping turns are included', () => {
    expect(() => verifiedExcerptSelection([turn(1, 0, 300), turn(2, 299, 600), turn(3, 599, 650)], 1, 2)).toThrow(
      'up to ten minutes'
    );
  });
});
