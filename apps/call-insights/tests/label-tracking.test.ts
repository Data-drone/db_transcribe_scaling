import { createMockRequest, createMockResponse, createMockRouter } from '@databricks/appkit/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerIntelligenceRoutes, trackingResponse } from '../server/intelligence/routes';
import type { DocumentStore, StoredDocument } from '../server/investigations/storage';

type Kit = Parameters<typeof registerIntelligenceRoutes>[0];
const actor = { id: 'analyst-1', email: 'analyst@example.com' };
const headers = { 'x-forwarded-user': actor.id, 'x-forwarded-email': actor.email, 'x-forwarded-access-token': 'test-only-token' };
const revision = { name: 'Re-verified after transfer', definition: 'Customer is asked to verify again after a transfer.', includeExamples: '', excludeExamples: '', speakerFocus: 'any', queue: 'Payments', startDate: '1900-01-01', endDate: '9999-12-31', version: 2, createdAt: '2026-10-24T00:00:00Z', promptHash: 'h' };
let query: ReturnType<typeof vi.fn<(statement: string, params?: unknown) => Promise<{ data: unknown[] }>>>;
let router: ReturnType<typeof createMockRouter>;

beforeEach(() => {
  vi.stubEnv('CALL_INSIGHTS_LABEL_ENDPOINT', 'configured-model');
  const document: StoredDocument = { id: 'label-1', kind: 'label', ownerId: actor.id, ownerEmail: actor.email, sharedWith: [], version: 3, createdAt: '', updatedAt: '', body: { currentVersion: 2, versions: [revision] } };
  const store: DocumentStore = { list: vi.fn(), get: vi.fn(() => Promise.resolve(document)), put: vi.fn(), share: vi.fn() };
  query = vi.fn((_statement: string, _params?: unknown) => Promise.resolve({ data: [] as unknown[] }));
  router = createMockRouter();
  const kit: Kit = { server: { extend: (callback) => callback(router.router as import('express').Application) }, analytics: { query: query as Kit['analytics']['query'] }, asUser: () => ({ analytics: { query: query as Kit['analytics']['query'] } }) };
  registerIntelligenceRoutes(kit, store, vi.fn());
});

async function post(body: unknown, withHeaders: Record<string, string> = headers) {
  const handle = router.getHandler('POST', '/api/intelligence/labels/:id/tracking') as (req: unknown, res: unknown) => Promise<void>;
  const res = createMockResponse();
  let status = 200;
  let json: unknown;
  res.status.mockImplementation((value: number) => {
    status = value;
    return res;
  });
  res.json.mockImplementation((value: unknown) => {
    json = value;
    return res;
  });
  await handle(createMockRequest({ headers: withHeaders, body, params: { id: 'label-1' } }), res);
  return { status, json };
}
const statements = () => query.mock.calls.map((call) => String(call[0]));

describe('tracked labels', () => {
  it('requires a trusted caller', async () => {
    expect((await post({ version: 2, enabled: true }, {})).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses to track a version without a completed full run', async () => {
    const response = await post({ version: 2, enabled: true });
    expect(response.status).toBe(409);
    expect(statements().some((s) => s.includes('MERGE INTO'))).toBe(false);
  });

  it('confirms the owner can read the scope, then stores the exact revision', async () => {
    query.mockImplementation((statement: string) => {
      if (statement.includes("run_type = 'full'")) return Promise.resolve({ data: [{ run_id: 'run-1' }] });
      if (statement.includes('WITH transcripts')) return Promise.resolve({ data: [{ interaction_id: 'c1', queue: 'Payments', agent_name: 'A', started_at: '2020-06-01', segments_json: '[]' }] });
      if (statement.includes('label_tracking_visible') && statement.includes('enabled_at'))
        return Promise.resolve({ data: [{ label_id: 'label-1', version: 2, enabled: true, enabled_at: '2026-10-26 08:00:00', last_run_at: '' }] });
      return Promise.resolve({ data: [] });
    });
    const response = await post({ version: 2, enabled: true });
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({ enabled: true, version: 2, lastRunAt: null });
    const merge = query.mock.calls.find((call) => String(call[0]).includes('MERGE INTO'));
    const params = JSON.stringify(merge?.[1]);
    expect(params).toContain(JSON.stringify(JSON.stringify(revision)));
    expect(params).toContain(actor.email);
  });

  it('stops tracking without requiring a full run', async () => {
    const response = await post({ version: 2, enabled: false });
    expect(response.status).toBe(200);
    expect(statements().some((s) => s.includes('SET enabled = FALSE'))).toBe(true);
  });

  it('never reports tracking as enabled from an ambiguous status value', () => {
    expect(trackingResponse({ enabled: 'yes' }, []).enabled).toBe(false);
    expect(trackingResponse(undefined, [{ day: '2020-06-01', evaluated: '10', matched: '2' }]).points).toEqual([{ date: '2020-06-01', evaluated: 10, matched: 2 }]);
  });
});
