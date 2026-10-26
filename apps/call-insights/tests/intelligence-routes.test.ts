import { createMockRouter, createMockRequest, createMockResponse } from '@databricks/appkit/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from '@databricks/appkit';
import { registerIntelligenceRoutes } from '../server/intelligence/routes';
import { type Actor, type StoredDocument, type DocumentStore } from '../server/investigations/storage';
import { labelInputSchema } from '../shared/intelligence';

type Kit = Parameters<typeof registerIntelligenceRoutes>[0];
const input = { name: 'Repeated verification', definition: 'Customer is asked for verification again after a transfer.', includeExamples: '', excludeExamples: '', speakerFocus: 'any', queue: 'Payments', startDate: '2016-01-01', endDate: '2016-12-31' };
const revision = { ...input, version: 1, createdAt: '2026-10-24T00:00:00Z', promptHash: 'hash' };
const actor = { id: 'analyst-1', email: 'analyst@example.com' };
const headers = { 'Content-Type': 'application/json', 'x-forwarded-user': actor.id, 'x-forwarded-email': actor.email, 'x-forwarded-access-token': 'test-only-caller-token' };
const base = '/api/intelligence';
let router: ReturnType<typeof createMockRouter>;
let store: DocumentStore;
let document: StoredDocument;
let query: Kit['analytics']['query'];
let runLabelJob: Parameters<typeof registerIntelligenceRoutes>[2];

beforeEach(() => {
  vi.stubEnv('CALL_INSIGHTS_LABEL_ENDPOINT', 'configured-model');
  document = { id: 'stored-label-id', kind: 'label', ownerId: actor.id, ownerEmail: actor.email, sharedWith: [], version: 5, createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z', body: { id: 'legacy-body-id', currentVersion: 1, versions: [revision] } };
  store = { list: vi.fn(() => Promise.resolve([document])), get: vi.fn(() => Promise.resolve(document)), put: vi.fn((kind: string, id: string | undefined, _actor: Actor, body: unknown) => Promise.resolve({ ...document, id: id ?? document.id, kind, body, version: document.version + 1 })), share: vi.fn(() => Promise.resolve(document)) };
  query = vi.fn(() => Promise.resolve({ data: [] }));
  runLabelJob = vi.fn(() => Promise.resolve({jobRunId:101}));
  router = createMockRouter();
  const kit: Kit = { server: { extend: (callback) => { callback(router.router as import('express').Application); } }, analytics: { query }, asUser: () => ({ analytics: { query } }) };
  registerIntelligenceRoutes(kit, store, runLabelJob);
});
afterEach(() => { vi.unstubAllEnvs(); });

async function request(path: string, options?: {method?: string; headers?: Record<string,string>; body?: string}) {
  const method = options?.method ?? 'GET';
  const route = path.endsWith('/runs') ? '/api/intelligence/labels/:id/runs' : path.endsWith(`/${document.id}`) ? '/api/intelligence/labels/:id' : path;
  const handle = router.getHandler(method, route) as (req: unknown, res: unknown) => Promise<void>;
  const parsedBody: unknown = options?.body ? JSON.parse(options.body) : {};
  const req: unknown = createMockRequest({headers: options?.headers ?? {}, body: parsedBody, params: {id: document.id}});
  const res = createMockResponse();
  let status = 200; let body: unknown;
  res.status.mockImplementation((value: number) => { status = value; return res; });
  res.json.mockImplementation((value: unknown) => { body = value; return res; });
  await handle(req,res);
  return {status,json: () => Promise.resolve(body)};
}

describe('real label workflow guards', () => {
  it('requires a trusted caller before reading definitions or starting a job', async () => {
    expect((await request(`${base}/labels`)).status).toBe(401);
    expect(store.list).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled(); expect(runLabelJob).not.toHaveBeenCalled();
  });
  it('uses the persisted document ID instead of a body label identifier', async () => {
    const response = await request(`${base}/labels`, { headers });
    expect(response.status).toBe(200); expect(await response.json()).toEqual([expect.objectContaining({ id: document.id })]);
    const created = await request(`${base}/labels`, { method: 'POST', headers, body: JSON.stringify(input) });
    expect(created.status).toBe(201); expect(await created.json()).toMatchObject({ id: document.id, currentVersion: 1 });
    expect(store.put).toHaveBeenCalledWith('label', undefined, actor, expect.objectContaining({ currentVersion: 1 }));
  });
  it('retains old revisions and uses optimistic concurrency for edits', async () => {
    const response = await request(`${base}/labels/${document.id}`, { method: 'PUT', headers, body: JSON.stringify({ ...input, definition: 'A more precise definition of customer re-verification.' }) });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ id: document.id, currentVersion: 2, versions: [revision, expect.objectContaining({ version: 2 })] });
    expect(store.put).toHaveBeenCalledWith('label', document.id, actor, expect.anything(), 5); expect(document.body).toMatchObject({ currentVersion: 1, versions: [revision] });
  });
  it('blocks a full run without a successful sample of this exact version', async () => {
    const response = await request(`${base}/labels/${document.id}/runs`, { method: 'POST', headers, body: JSON.stringify({ version: 1, type: 'full', cohortId: 'preview' }) });
    expect(response.status).toBe(409); expect(query).toHaveBeenCalledWith(expect.stringContaining("run_type = 'sample'"), { label: sql.string(document.id), version: sql.number(1), owner: sql.string(actor.email) });
    expect(runLabelJob).not.toHaveBeenCalled(); expect(store.get).toHaveBeenCalledTimes(1);
  });
  it('treats an SDK zero-row result without data as no successful prior sample', async () => {
    vi.mocked(query).mockResolvedValue({ row_count: 0 });
    const response = await request(`${base}/labels/${document.id}/runs`, { method: 'POST', headers, body: JSON.stringify({ version: 1, type: 'full' }) });
    expect(response.status).toBe(409);
    expect(runLabelJob).not.toHaveBeenCalled();
  });
  it('does not turn an empty authorized masked cohort into a successful sample', async () => {
    const response = await request(`${base}/labels/${document.id}/runs`, { method: 'POST', headers, body: JSON.stringify({ version: 1, type: 'sample' }) });
    expect(response.status).toBe(422); expect(runLabelJob).not.toHaveBeenCalled(); expect(query).toHaveBeenCalledTimes(1);
  });
  it('freezes actual authorized masked text before submitting a durable sample job', async () => {
    const segments = [{idx:1,start:0,end:4,role:'customer',text:'I already verified my identity.'}];
    const candidate = {interaction_id:'call-1',queue:'Payments',agent_name:'Agent',started_at:'2016-04-01',segments_json:segments};
    vi.mocked(query).mockImplementation((statement) => Promise.resolve({data: statement.includes('WITH transcripts') ? [candidate] : statement.includes('SUM(estimated_tokens)') ? [{tokens:0}] : []}));
    const response = await request(`${base}/labels/${document.id}/runs`, {method:'POST',headers,body:JSON.stringify({version:1,type:'sample',interaction_ids:['unauthorized-client-id']})});
    expect(response.status).toBe(202);
    expect(runLabelJob).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(query).toHaveBeenCalledWith(expect.stringContaining('.label_run_scope SELECT'), expect.objectContaining({scope:sql.string(JSON.stringify([{...candidate,segments_json:JSON.stringify(segments)}]))}));
    const statements = vi.mocked(query).mock.calls.map((call) => call[0]);
    expect(statements.findIndex((statement) => statement.includes('.label_run_scope SELECT'))).toBeGreaterThan(statements.findIndex((statement) => statement.includes('.label_runs (')));
  });
  it('records worker submission failure instead of reporting a successful model run', async () => {
    const candidate = {interaction_id:'call-1',queue:'Payments',agent_name:'Agent',started_at:'2016-04-01',segments_json:'[]'};
    vi.mocked(query).mockImplementation((statement) => Promise.resolve({data: statement.includes('WITH transcripts') ? [candidate] : []}));
    vi.mocked(runLabelJob).mockRejectedValue(new Error('Worker unavailable'));
    const response = await request(`${base}/labels/${document.id}/runs`, {method:'POST',headers,body:JSON.stringify({version:1,type:'sample'})});
    expect(response.status).toBe(500);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status='failed'"), expect.anything());
  });
  it('rejects backwards date ranges', () => { expect(labelInputSchema.safeParse({ ...input, startDate: '2026-10-24', endDate: '2026-10-01' }).success).toBe(false); });
});
