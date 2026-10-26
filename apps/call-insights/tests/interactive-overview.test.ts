import { createMockRequest, createMockResponse, createMockRouter } from '@databricks/appkit/testing';
import { sql } from '@databricks/appkit';
import { describe, expect, it, vi } from 'vitest';
import { alignPeriods } from '../client/src/lib/periods';
import { dayPeriod, periodDay, readSelection, scopeFor } from '../client/src/lib/scope';
import { trackingJumps } from '../client/src/lib/tracking';
import { loadOverview, loadThemeMap, parseFocus, registerInsightsRoutes, type InsightsQueryName, type InsightsQueryRunner } from '../server/insights/routes';
import type { OverviewData } from '../shared/insights';

const headers = { 'x-forwarded-user': 'analyst-1', 'x-forwarded-email': 'analyst@example.com', 'x-forwarded-access-token': 'test-only-token' };
const req = createMockRequest({ headers }) as unknown as Parameters<InsightsQueryRunner>[0];
const runner = (rows: Partial<Record<InsightsQueryName, Record<string, unknown>[]>> = {}) =>
  vi.fn((_req: unknown, name: InsightsQueryName) => Promise.resolve(rows[name] ?? [])) as unknown as InsightsQueryRunner & ReturnType<typeof vi.fn>;

describe('day focus', () => {
  it('turns a clicked day into a one-day scope and rejects impossible days', () => {
    const selection = readSelection(new URLSearchParams(`period=${dayPeriod('2020-06-01')}&queue=Payments`));
    expect(periodDay(selection.period)).toBe('2020-06-01');
    expect(scopeFor(selection, undefined)).toEqual({ queue: 'Payments', start: '2020-06-01', end: '2020-06-01' });
    expect(readSelection(new URLSearchParams('period=d:2020-02-30')).period).toBe('all');
  });
});

describe('period comparison', () => {
  it('pairs each day with the same offset day in the previous equal period', () => {
    const current = { periodStart: '2020-06-01', periodEnd: '2020-06-02', daily: [{ date: '2020-06-01', calls: 121, negativeShare: null }, { date: '2020-06-02', calls: 409, negativeShare: null }] } as OverviewData;
    const previous = { daily: [{ date: '2020-05-30', calls: 439, negativeShare: null }] } as OverviewData;
    expect(alignPeriods(current, previous).map((r) => [r.date, r.Calls, r['Calls before']])).toEqual([
      ['2020-06-01', 121, 439],
      ['2020-06-02', 409, 0],
    ]);
    const wider = { ...current, periodStart: '2020-05-31' } as OverviewData;
    expect(alignPeriods(wider, previous).find((r) => r.date === '2020-06-02')?.['Calls before']).toBe(439);
  });

  it('flags only material day-over-day jumps in a tracked label', () => {
    const jumps = trackingJumps([
      { date: '2020-05-30', evaluated: 40, matched: 4 },
      { date: '2020-06-01', evaluated: 40, matched: 5 },
      { date: '2020-06-02', evaluated: 40, matched: 14 },
      { date: '2020-06-03', evaluated: 3, matched: 3 },
    ]);
    expect(jumps.map((j) => j.date)).toEqual(['2020-06-02']);
  });
});

describe('overview focus', () => {
  it('validates focus parameters', () => {
    expect(parseFocus({ focus_reason: 'pay bill', focus_theme: 'th-1a' })).toEqual({ reason: 'pay bill', theme: 'th-1a' });
    expect(() => parseFocus({ focus_theme: "x' OR 1=1" })).toThrow();
  });

  it('sends each query exactly the parameters it declares', async () => {
    const run = runner();
    await loadOverview(run, req, { queue: '', start: '', end: '' }, { reason: 'pay bill', theme: 'th-1' });
    const params = (name: string) => (run.mock.calls.find((c) => c[1] === name)?.[2] ?? {}) as Record<string, unknown>;
    expect(Object.keys(params('overview_summary')).sort()).toEqual(['contact_reason', 'end_date', 'queue', 'start_date', 'theme_id']);
    expect(Object.keys(params('daily_activity')).sort()).toEqual(['contact_reason', 'end_date', 'queue', 'start_date', 'theme_id']);
    // The reason chart highlights the focused reason instead of filtering the others away.
    expect(Object.keys(params('overview_contact_reasons')).sort()).toEqual(['end_date', 'queue', 'start_date', 'theme_id']);
    expect(params('overview_summary').contact_reason).toEqual(sql.string('pay bill'));
  });
});

describe('theme map', () => {
  it('drops calls without map coordinates', async () => {
    const data = await loadThemeMap(
      runner({ theme_map: [{ interaction_id: 'c1', theme_id: 't', map_x: '0.2', map_y: 0.4, queue: 'Payments', day: '2020-06-01', duration_seconds: 60 }, { interaction_id: 'c2', theme_id: 't', map_x: null, map_y: null }] }),
      req,
      { queue: '', start: '', end: '' }
    );
    expect(data.points).toEqual([{ id: 'c1', theme: 't', x: 0.2, y: 0.4, queue: 'Payments', day: '2020-06-01', durationSeconds: 60, sentimentEnd: null }]);
  });

  it('serves the map route rather than treating "map" as a theme id', async () => {
    const router = createMockRouter();
    const run = runner({ theme_map: [] });
    registerInsightsRoutes(router.router as never, run);
    const handle = router.getHandler('GET', '/api/insights/themes/map') as (req: unknown, res: unknown) => Promise<void>;
    const res = createMockResponse();
    let body: unknown;
    res.json.mockImplementation((value: unknown) => {
      body = value;
      return res;
    });
    await handle(createMockRequest({ headers, query: {} }), res);
    expect(body).toEqual({ points: [], truncated: false });
    expect(run).toHaveBeenCalledWith(expect.anything(), 'theme_map', expect.anything());
  });
});
