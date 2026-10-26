import { describe, expect, it } from 'vitest';
import { evidenceReturnPath, evidenceTime } from '../client/src/lib/evidence';

describe('source evidence navigation', () => {
  it('preserves the filtered cohort or source investigation', () => {
    expect(evidenceReturnPath('/explore?queue=Cards&start=2020-06-01&page=2')).toBe(
      '/explore?queue=Cards&start=2020-06-01&page=2'
    );
    expect(evidenceReturnPath('/cases/8dc0-134a')).toBe('/cases/8dc0-134a');
    expect(evidenceReturnPath('/labels/ef2a-355b')).toBe('/labels/ef2a-355b');
    expect(evidenceReturnPath('/themes/th-1a2b?period=7d&queue=all')).toBe('/themes/th-1a2b?period=7d&queue=all');
    expect(evidenceReturnPath('/?period=1d&queue=Payments')).toBe('/?period=1d&queue=Payments');
  });
  it('rejects external or ambiguous return paths', () => {
    for (const path of [
      'https://example.com',
      '//example.com',
      '/\\example.com',
      '/explore-other',
      '/calls/123',
      '/explore\n',
    ])
      expect(evidenceReturnPath(path)).toBe('/explore');
  });
  it('never seeks to a negative or nonfinite timestamp', () => {
    expect(evidenceTime('42.5')).toBe(42.5);
    for (const value of ['-1', 'Infinity', 'NaN', null]) expect(evidenceTime(value)).toBe(0);
  });
});
