import { describe, expect, it } from 'vitest';
import { metricChange, readFilters, readSelection, scopeFor, filterParams } from '../client/src/lib/scope';
import { toPath } from '../client/src/router';
import type { Bounds } from '../shared/insights';

const bounds: Bounds = { minDate: '2020-03-15', maxDate: '2020-06-02', calls: 1446, recordingDays: 4, queues: ['Payments'] };

describe('scope and navigation', () => {
  it('anchors periods on the latest recording, not today', () => {
    expect(scopeFor({ period: '1d', queue: '' }, bounds)).toEqual({ queue: '', start: '2020-06-02', end: '2020-06-02' });
    expect(scopeFor({ period: '7d', queue: 'Payments' }, bounds)).toEqual({ queue: 'Payments', start: '2020-05-27', end: '2020-06-02' });
    expect(scopeFor({ period: 'all', queue: '' }, bounds)).toEqual({ queue: '', start: '', end: '' });
  });

  it('keeps the selected cohort when opening a call and returning to results', () => {
    const selection = readSelection(new URLSearchParams('period=7d&queue=Payments'));
    const filters = readFilters(new URLSearchParams('q=charged%20twice&reason=pay%20bill&sentiment=negative&theme=th-1&silence=1&page=2'));
    const results = toPath({ name: 'explore', filters }, selection);
    const callPath = new URL(toPath({ name: 'call', id: 'c1', from: results, t: 34.567 }), 'https://app.example');
    const back = callPath.searchParams.get('from')!;
    expect(back).toBe(results);
    const params = new URLSearchParams(back.split('?')[1]);
    expect(readSelection(params)).toEqual(selection);
    expect(readFilters(params)).toEqual(filters);
    expect(callPath.searchParams.get('t')).toBe('34.56');
  });

  it('drops unsafe or out-of-range filter values before they reach the API', () => {
    const filters = readFilters(new URLSearchParams("sentiment=missing&page=9999999&theme=x'%20OR%201=1"));
    expect(filters).toMatchObject({ sentiment: '', page: 1, theme: '' });
    expect(readSelection(new URLSearchParams('period=forever&queue=all'))).toEqual({ period: 'all', queue: '' });
  });

  it('preserves literal search characters through the URL', () => {
    const q = 'refund 10% _ + & # ?';
    expect(readFilters(new URLSearchParams(filterParams({ q }))).q).toBe(q);
  });

  it('distinguishes absent baselines from measured zero shares', () => {
    expect(metricChange(15, 10, 'percent')).toBe('+50% vs previous equal period');
    expect(metricChange(15, 0, 'percent')).toBe('No calls in the previous equal period');
    expect(metricChange(0.1, null, 'points')).toBe('No evaluated prior-period comparison');
    expect(metricChange(0.1, 0, 'points')).toBe('+10 pts vs previous equal period');
    expect(metricChange(58, 62, 'seconds')).toBe('-4s vs previous equal period');
    expect(metricChange(null, 62, 'seconds')).toBe('Not evaluated in this period');
  });
});
