import { createMockRequest, createMockResponse, createMockRouter } from '@databricks/appkit/testing';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { registerInvestigationRoutes, investigationBrief, investigationOrigin } from '../server/investigations/routes';
import type { SourceReader } from '../server/investigations/sources';
import { HttpError, requestActor, type DocumentStore, type StoredDocument } from '../server/investigations/storage';
import { investigationSchema } from '../shared/investigations';

const caseId = '33030121-d182-4244-905d-9f9273fab6d6';
const clip = {
  id: 'clip-1',
  type: 'clip',
  interactionId: 'call-1',
  start: 2,
  end: 8,
  note: 'Evidence supports a hypothesis.',
  createdBy: 'owner@example.com',
  createdAt: '2026-10-24T12:00:00Z',
};
function fixture(withClip = false) {
  const record: StoredDocument = {
    id: caseId,
    kind: 'investigation',
    ownerId: 'owner',
    ownerEmail: 'owner@example.com',
    sharedWith: ['reader@example.com'],
    createdAt: '2026-10-24T12:00:00Z',
    updatedAt: '2026-10-24T12:00:00Z',
    version: 1,
    body: { title: 'Review the payment flow', question: 'What caused this contact?', items: withClip ? [clip] : [] },
  };
  const store: DocumentStore = {
    get: vi.fn<DocumentStore['get']>().mockResolvedValue(record),
    list: vi.fn<DocumentStore['list']>().mockResolvedValue([record]),
    put: vi
      .fn<DocumentStore['put']>()
      .mockImplementation((_kind, _id, _actor, body) => Promise.resolve({ ...record, body, version: 2 })),
    share: vi
      .fn<DocumentStore['share']>()
      .mockImplementation((_kind, _id, _actor, sharedWith) => Promise.resolve({ ...record, sharedWith, version: 2 })),
  };
  const sources: SourceReader = {
    call: vi.fn<SourceReader['call']>().mockResolvedValue({
      interaction_id: 'call-1',
      duration_seconds: 60,
      queue: 'Payments',
      started_at: '2020-06-22',
      audio_path: null,
    }),
    segments: vi.fn<SourceReader['segments']>().mockResolvedValue([
      {
        segment_idx: 1,
        start_seconds: 2,
        end_seconds: 8,
        speaker_role: 'customer',
        text: 'The masked, authorized source text.',
        is_masked: true,
      },
    ]),
  };
  const router = createMockRouter();
  router.router.use = vi.fn().mockReturnValue(router.router);
  registerInvestigationRoutes(router.router, store, sources);
  const request = (body: unknown = {}, user = 'owner'): Request =>
    createMockRequest({
      obo: { userId: user, email: `${user}@example.com`, token: `token-${user}` },
      params: { caseId },
      body,
    }) as Request;
  type TestHandler = (req: Request, res: ReturnType<typeof createMockResponse>) => Promise<void>;
  const handler = (method: string, path: string): TestHandler => router.getHandler(method, path) as TestHandler;
  return { record, store, sources, handler, request };
}

describe('persistent investigations source authorization', () => {
  it('stores source references and notes, deriving the excerpt from current masked source rather than trusting client text', async () => {
    const { store, handler, request } = fixture();
    const res = createMockResponse();
    await handler('POST', '/api/investigations/:caseId/items')(
      request({
        version: 1,
        item: {
          type: 'clip',
          interactionId: 'call-1',
          start: 2.5,
          end: 7,
          note: 'A useful source.',
          excerpt: 'Forged raw source.',
        },
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(201);
    const saved = vi.mocked(store.put).mock.calls[0][3];
    expect(JSON.stringify(saved)).not.toContain('Forged raw source');
    expect(JSON.stringify(saved)).not.toContain('The masked, authorized source text');
    const payload = investigationSchema.parse(res.json.mock.calls[0][0]);
    expect(Object.values(payload.excerpts)[0].text).toBe('The masked, authorized source text.');
    expect(payload.items[0].start).toBe(2);
    expect(payload.items[0].end).toBe(8);
  });
  it('rejects saving an unmasked source range before changing persistent state', async () => {
    const { sources, store, handler, request } = fixture();
    const res = createMockResponse();
    sources.segments = vi.fn<SourceReader['segments']>().mockResolvedValue([
      {
        segment_idx: 1,
        start_seconds: 2,
        end_seconds: 8,
        speaker_role: 'customer',
        text: 'Raw source.',
        is_masked: false,
      },
    ]);
    await handler('POST', '/api/investigations/:caseId/items')(
      request({
        version: 1,
        item: { type: 'clip', interactionId: 'call-1', start: 2, end: 8, note: 'A useful source.' },
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(store.put).not.toHaveBeenCalled();
  });
  it('does not persist a whole-turn expansion beyond the current audio duration', async () => {
    const { sources, store, handler, request } = fixture();
    const res = createMockResponse();
    sources.segments = vi.fn<SourceReader['segments']>().mockResolvedValue([
      {
        segment_idx: 1,
        start_seconds: 58,
        end_seconds: 61,
        speaker_role: 'customer',
        text: 'Masked text with inconsistent timing.',
        is_masked: true,
      },
    ]);
    await handler('POST', '/api/investigations/:caseId/items')(
      request({
        version: 1,
        item: { type: 'clip', interactionId: 'call-1', start: 58, end: 59, note: 'A useful source.' },
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(store.put).not.toHaveBeenCalled();
  });
  it('requires source authorization again when a shared reader reopens a case', async () => {
    const { sources, handler, request } = fixture(true);
    const res = createMockResponse();
    sources.call = vi.fn<SourceReader['call']>().mockRejectedValue(new HttpError(403, 'Source access denied.'));
    await handler('GET', '/api/investigations/:caseId')(request({}, 'reader'), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Source access denied.' });
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('Evidence supports a hypothesis');
  });
  it('does not share a case when the owner no longer has source access', async () => {
    const { sources, store, handler, request } = fixture(true);
    const res = createMockResponse();
    sources.call = vi.fn<SourceReader['call']>().mockRejectedValue(new HttpError(403, 'Source access denied.'));
    await handler('POST', '/api/investigations/:caseId/share')(
      request({ version: 1, emails: ['colleague@example.com'] }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(store.share).not.toHaveBeenCalled();
  });
  it('keeps a named reader read-only', async () => {
    const { store, handler, request } = fixture();
    const res = createMockResponse();
    await handler('POST', '/api/investigations/:caseId/items')(
      request({ version: 1, item: { type: 'note', note: 'A reader cannot change this.' } }, 'reader'),
      res
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(store.put).not.toHaveBeenCalled();
  });
  it('exports only reauthorized excerpts, absolute source links, and the actual selected-sample limitation', () => {
    const record = investigationSchema.parse({
      id: caseId,
      title: 'Finding',
      question: '',
      items: [clip],
      ownerEmail: 'owner@example.com',
      sharedWith: [],
      createdAt: '2026-10-24',
      updatedAt: '2026-10-24',
      version: 1,
      canEdit: true,
      excerpts: { 'clip-1': { text: 'Verified masked text.', queue: 'Payments', startedAt: '2020-06-22' } },
    });
    const brief = investigationBrief(record, 'https://call-insights.example.com');
    expect(brief).toContain('https://call-insights.example.com/calls/call-1?t=2');
    expect(brief).toContain('Verified masked text.');
    expect(brief).toContain('not an estimate of prevalence or causality');
  });
});

describe('investigation export origins', () => {
  const request = { protocol: 'http', get: (_name: 'host') => 'localhost:8000' };
  it('uses the configured HTTPS origin in production instead of internal or forwarded request details', () => {
    expect(investigationOrigin(request, 'https://call-insights.example.com/', true)).toBe(
      'https://call-insights.example.com'
    );
  });
  it('requires an explicit safe origin for production exports', () => {
    for (const configured of [
      '',
      'not a URL',
      'http://call-insights.example.com',
      'javascript:alert(1)',
      'https://user:password@example.com',
      'https://example.com/subpath',
      'https://example.com?token=secret',
      'https://example.com#fragment',
    ])
      expect(() => investigationOrigin(request, configured, true)).toThrow(HttpError);
  });
  it('supports loopback development when no public URL is configured', () => {
    expect(investigationOrigin(request, '', false)).toBe('http://localhost:8000');
  });
});

describe('trusted investigation actor', () => {
  const headers = {
    'x-forwarded-user': '  owner  ',
    'x-forwarded-access-token': 'test-only-user-token',
    'x-forwarded-email': ' Owner@Example.com ',
  };
  it('normalizes the forwarded actor and named-sharing email', () => {
    expect(requestActor(createMockRequest({ headers }) as Request)).toEqual({
      id: 'owner',
      email: 'owner@example.com',
    });
  });
  it('requires the user ID, access token and valid email without an app identity fallback', () => {
    for (const header of ['x-forwarded-user', 'x-forwarded-access-token', 'x-forwarded-email'])
      expect(() => requestActor(createMockRequest({ headers: { ...headers, [header]: '' } }) as Request)).toThrow(
        HttpError
      );
    expect(() =>
      requestActor(createMockRequest({ headers: { ...headers, 'x-forwarded-email': 'not-an-email' } }) as Request)
    ).toThrow(HttpError);
  });
});
