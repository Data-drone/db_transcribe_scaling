import { createMockRequest, createMockResponse, createMockRouter } from '@databricks/appkit/testing';
import { sql } from '@databricks/appkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInsightsQueries,
  loadCall,
  loadChanges,
  loadOverview,
  parseScope,
  registerInsightsRoutes,
  type InsightsQueryName,
  type InsightsQueryRunner,
} from '../server/insights/routes';

const headers = { 'x-forwarded-user': 'analyst-1', 'x-forwarded-email': 'analyst@example.com', 'x-forwarded-access-token': 'test-only-token' };
type Rows = Partial<Record<InsightsQueryName, Record<string, unknown>[] | Error>>;
const req = createMockRequest({ headers }) as unknown as Parameters<InsightsQueryRunner>[0];

function runner(rows: Rows) {
  return vi.fn((_req: unknown, name: InsightsQueryName) => {
    const value = rows[name];
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value ?? []);
  }) as unknown as InsightsQueryRunner & ReturnType<typeof vi.fn>;
}

describe('insights scope parsing', () => {
  it('accepts real calendar days and treats "all" as every queue', () => {
    expect(parseScope({ queue: 'all', start: '2020-06-01', end: '2020-06-02' })).toEqual({ queue: '', start: '2020-06-01', end: '2020-06-02' });
    expect(parseScope({})).toEqual({ queue: '', start: '', end: '' });
  });
  it('rejects impossible dates and backwards ranges before any SQL runs', () => {
    expect(() => parseScope({ start: '2020-02-30' })).toThrow();
    expect(() => parseScope({ start: '2020-06-02', end: '2020-06-01' })).toThrow();
    expect(() => parseScope({ start: "2020-06-01' OR 1=1 --" })).toThrow();
  });
});

describe('insights mapping', () => {
  it('reports the inclusive last day of the period and coerces warehouse strings', async () => {
    const run = runner({
      overview_summary: [{ interaction_count: '409', previous_interaction_count: '121', period_start: '2020-06-02T00:00:00.000Z', period_end: '2020-06-03T00:00:00.000Z', previous_period_start: '2020-06-01T00:00:00.000Z', negative_share: '0.250', avg_duration_seconds: '61.5' }],
      overview_contact_reasons: [{ contact_reason: 'pay bill', interaction_count: '12', avg_duration_seconds: null, negative_count: '3' }],
      daily_activity: [{ day: '2020-06-02T00:00:00.000Z', interaction_count: '409', negative_share: null }],
    });
    const data = await loadOverview(run, req, { queue: '', start: '2020-06-02', end: '2020-06-02' });
    expect(data).toMatchObject({ periodStart: '2020-06-02', periodEnd: '2020-06-02', previousStart: '2020-06-01', calls: 409, previousCalls: 121, negativeShare: 0.25, avgDurationSeconds: 61.5 });
    expect(data.reasons[0]).toEqual({ name: 'pay bill', calls: 12, avgDurationSeconds: null, negative: 3 });
    expect(data.daily).toEqual([{ date: '2020-06-02', calls: 409, negativeShare: null }]);
  });

  it('does not measure change when the previous equal period has no calls', async () => {
    const run = runner({ overview_summary: [{ previous_interaction_count: 0, previous_period_start: '2020-02-14' }] });
    const data = await loadChanges(run, req, { queue: '', start: '', end: '' }, { minCalls: 3, threshold: 0.25 });
    expect(data.comparable).toBe(false);
    expect(data.changes).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('passes typed thresholds to the change query when a baseline exists', async () => {
    const run = runner({
      overview_summary: [{ previous_interaction_count: 121 }],
      overview_changes: [{ kind: 'theme', id: 'th-1', name: 'Bill paid twice', current_count: 30, previous_count: 5, current_share: 0.2, previous_share: 0.05, change_pct: 3 }],
    });
    const data = await loadChanges(run, req, { queue: 'Payments', start: '2020-06-02', end: '2020-06-02' }, { minCalls: 5, threshold: 0.3 });
    expect(data.changes[0]).toMatchObject({ kind: 'theme', id: 'th-1', changePct: 3, current: 30, previous: 5 });
    expect(run).toHaveBeenLastCalledWith(req, 'overview_changes', expect.objectContaining({ min_calls: sql.int(5), threshold: sql.double(0.3), queue: sql.string('Payments') }));
  });

  it('withholds unmasked turns and tolerates a workspace without theme tables', async () => {
    const run = runner({
      call_detail: [{ interaction_id: 'c1', duration_seconds: '40', queue: 'Payments', is_enriched: false, audio_path: '/Volumes/x/c1.wav' }],
      call_segments: [
        { segment_idx: 0, start_seconds: 0, end_seconds: 3, speaker_role: 'agent', text: 'Hello', is_masked: true },
        { segment_idx: 1, start_seconds: 3, end_seconds: 6, speaker_role: 'customer', text: 'raw text', is_masked: false },
      ],
      call_key_moments: [],
      call_themes: new Error('[TABLE_OR_VIEW_NOT_FOUND] theme_membership_current'),
    });
    const call = await loadCall(run, req, 'c1');
    expect(call.segments.map((s) => s.text)).toEqual(['Hello', null]);
    expect(call.themes).toEqual([]);
    expect(call.audio).toBe(true);
    expect(call.summary).toBeNull();
  });

  it('reports an inaccessible call as not found', async () => {
    await expect(loadCall(runner({}), req, 'hidden')).rejects.toMatchObject({ status: 404 });
  });
});

describe('insights routes', () => {
  let router: ReturnType<typeof createMockRouter>;
  async function call(path: string, run: InsightsQueryRunner, options: { headers?: Record<string, string>; query?: Record<string, string>; params?: Record<string, string> } = {}) {
    router = createMockRouter();
    registerInsightsRoutes(router.router as never, run);
    const handle = router.getHandler('GET', path) as (req: unknown, res: unknown) => Promise<void>;
    const res = createMockResponse();
    let status = 200;
    let body: unknown;
    res.status.mockImplementation((value: number) => {
      status = value;
      return res;
    });
    res.json.mockImplementation((value: unknown) => {
      body = value;
      return res;
    });
    await handle(createMockRequest({ headers: options.headers ?? {}, query: options.query ?? {}, params: options.params ?? {} }), res);
    return { status, body };
  }
  beforeEach(() => vi.clearAllMocks());

  it('fails closed without a trusted user before running any query', async () => {
    const run = runner({});
    const response = await call('/api/insights/overview', run);
    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects malformed scope as a bad request', async () => {
    const response = await call('/api/insights/overview', runner({}), { headers, query: { start: 'yesterday' } });
    expect(response.status).toBe(400);
  });

  it('explains how to set up themes when their tables are missing', async () => {
    const response = await call('/api/insights/themes', runner({ themes_list: new Error('[TABLE_OR_VIEW_NOT_FOUND] themes_current') }), { headers });
    expect(response.status).toBe(503);
    expect((response.body as { error: string }).error).toMatch(/theme-tables\.sql/);
  });

  it('returns no run until the theme builder has completed', async () => {
    const response = await call('/api/insights/themes', runner({ themes_list: [] }), { headers });
    expect(response.body).toEqual({ run: null, callsInScope: 0, themedInScope: 0, themes: [] });
  });

  it('rejects theme identifiers that are not opaque IDs', async () => {
    const response = await call('/api/insights/explore', runner({}), { headers, query: { theme: "x' OR 1=1" } });
    expect(response.status).toBe(400);
  });

  it('maps explore paging and the silence filter onto query parameters', async () => {
    const run = runner({ explore_interactions: [], explore_count: [{ total_count: 60 }] });
    const response = await call('/api/insights/explore', run, { headers, query: { page: '3', silence: '1', q: 'refund' } });
    expect(response.body).toMatchObject({ total: 60, pageSize: 25 });
    expect(run).toHaveBeenCalledWith(expect.anything(), 'explore_interactions', expect.objectContaining({ row_offset: sql.int(50), min_silence: sql.double(10), search_text: sql.string('refund') }));
  });
});

describe('insights query loader', () => {
  it('only executes registered per-user query files', async () => {
    const query = vi.fn(() => Promise.resolve({ data: [{ interaction_count: 1 }] }));
    const run = createInsightsQueries({ asUser: () => ({ analytics: { query } }) });
    await expect(run(req, 'dataset_bounds')).resolves.toEqual([{ interaction_count: 1 }]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM serverless_stable_prvwqx_catalog.call_insights.interactions'), {});
    await expect(run(req, '../secrets' as InsightsQueryName)).rejects.toMatchObject({ status: 400 });
  });
});
