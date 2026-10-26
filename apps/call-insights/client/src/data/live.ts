import type { ExploreFilters, LabelTracking, Scope } from '../../../shared/insights';
import {
  investigationSchema,
  investigationSummarySchema,
  type EvidenceInput,
  type Investigation,
} from '../../../shared/investigations';
import type { IntelligenceLabel, LabelInput, LabelRun, RunEstimate } from '../../../shared/intelligence';
import { z } from 'zod';
import { DataError, type DataSource, type LabelSummaryRow, type RunResults, type TrackingStatusRow } from './source';

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(path, {
    ...rest,
    headers: { Accept: 'application/json', ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!response.ok) {
    let message = `The request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') message = body.error;
    } catch {
      /* Non-JSON error bodies keep the status message. */
    }
    throw new DataError(message, response.status);
  }
  return (await response.json()) as T;
}

function query(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== '' && value !== false) search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
}
const scopeQuery = (scope: Scope) => ({ queue: scope.queue, start: scope.start, end: scope.end });
const investigation = (value: unknown): Investigation => investigationSchema.parse(value);

export function createLiveSource(): DataSource {
  return {
    mode: 'live',
    describe: 'Warehouse data · your Databricks permissions',
    async identity() {
      try {
        const who = await request<{ email?: string; user?: string }>('/api/whoami');
        return { email: who.email ?? null, name: who.email?.split('@')[0]?.replace(/[._]/g, ' ') ?? null };
      } catch {
        return { email: null, name: null };
      }
    },
    bounds: () => request('/api/insights/bounds'),
    overview: (scope) => request(`/api/insights/overview${query(scopeQuery(scope))}`),
    changes: (scope) => request(`/api/insights/changes${query(scopeQuery(scope))}`),
    explore: (scope: Scope, filters: ExploreFilters) =>
      request(
        `/api/insights/explore${query({
          ...scopeQuery(scope),
          q: filters.q,
          reason: filters.reason,
          sentiment: filters.sentiment,
          theme: filters.theme,
          silence: filters.silence ? '1' : '',
          page: filters.page > 1 ? filters.page : undefined,
        })}`
      ),
    call: (id) => request(`/api/insights/calls/${encodeURIComponent(id)}`),
    audioUrl: (id) => `/api/calls/${encodeURIComponent(id)}/audio`,
    themes: (scope) => request(`/api/insights/themes${query(scopeQuery(scope))}`),
    theme: (scope, id) => request(`/api/insights/themes/${encodeURIComponent(id)}${query(scopeQuery(scope))}`),
    cases: {
      async list() {
        const body = await request<{ investigations: unknown[] }>('/api/investigations');
        return z.array(investigationSummarySchema).parse(body.investigations);
      },
      get: async (id) => investigation(await request(`/api/investigations/${encodeURIComponent(id)}`)),
      create: async (title, question = '') =>
        investigation(await request('/api/investigations', { method: 'POST', json: { title, question } })),
      update: async (id, input) =>
        investigation(await request(`/api/investigations/${encodeURIComponent(id)}`, { method: 'PATCH', json: input })),
      addItem: async (id, item: EvidenceInput, version) =>
        investigation(await request(`/api/investigations/${encodeURIComponent(id)}/items`, { method: 'POST', json: { item, version } })),
      share: async (id, emails, version) =>
        investigation(await request(`/api/investigations/${encodeURIComponent(id)}/share`, { method: 'POST', json: { emails, version } })),
      async brief(id) {
        const response = await fetch(`/api/investigations/${encodeURIComponent(id)}/brief`);
        if (!response.ok) throw new DataError('The brief could not be exported.', response.status);
        return { filename: `investigation-${id}.md`, markdown: await response.text() };
      },
    },
    labels: {
      list: () => request<IntelligenceLabel[]>('/api/intelligence/labels'),
      summary: () => request<{ latest: LabelSummaryRow[]; tracking: TrackingStatusRow[] }>('/api/intelligence/summary'),
      create: (input: LabelInput) => request<IntelligenceLabel>('/api/intelligence/labels', { method: 'POST', json: input }),
      update: (id, input) =>
        request<IntelligenceLabel>(`/api/intelligence/labels/${encodeURIComponent(id)}`, { method: 'PUT', json: input }),
      runs: (id) => request<LabelRun[]>(`/api/intelligence/labels/${encodeURIComponent(id)}/runs`),
      sample: (id, version) =>
        request<{ runId: string; count: number }>(`/api/intelligence/labels/${encodeURIComponent(id)}/runs`, {
          method: 'POST',
          json: { version, type: 'sample' },
        }),
      estimate: (id, version) =>
        request<RunEstimate>(`/api/intelligence/labels/${encodeURIComponent(id)}/estimate`, { method: 'POST', json: { version } }),
      full: (id, version, cohortId) =>
        request<{ runId: string; count: number }>(`/api/intelligence/labels/${encodeURIComponent(id)}/runs`, {
          method: 'POST',
          json: { version, type: 'full', cohortId },
        }),
      results: (runId, page) => request<RunResults>(`/api/intelligence/runs/${encodeURIComponent(runId)}/results${query({ page })}`),
      async feedback(runId, interactionId, verdict) {
        await request(`/api/intelligence/runs/${encodeURIComponent(runId)}/feedback`, {
          method: 'PUT',
          json: { interactionId, verdict },
        });
      },
      tracking: (id) => request<LabelTracking>(`/api/intelligence/labels/${encodeURIComponent(id)}/tracking`),
      setTracking: (id, version, enabled) =>
        request<LabelTracking>(`/api/intelligence/labels/${encodeURIComponent(id)}/tracking`, {
          method: 'POST',
          json: { version, enabled },
        }),
    },
  };
}
