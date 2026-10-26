import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql } from '@databricks/appkit';
import type { Request as IAppRequest } from 'express';
import { z } from 'zod';
import type {
  Bounds,
  CallDetail,
  ChangesData,
  ExploreData,
  OverviewData,
  Scope,
  ThemeDetail,
  ThemeRun,
  ThemesData,
  ThemeSummary,
} from '../../shared/insights';
import { HttpError, requestActor, respondError } from '../investigations/storage';

type Marker = ReturnType<typeof sql.string> | ReturnType<typeof sql.number>;
type Params = Record<string, Marker>;
type Row = Record<string, unknown>;
type Router = {
  get: (path: string, handler: (req: IAppRequest, res: import('express').Response) => void | Promise<void>) => unknown;
};
export interface InsightsAnalytics {
  asUser(req: IAppRequest): { analytics: { query(text: string, parameters?: Params): Promise<unknown> } };
}

/** Only these fixed, reviewed .obo.sql files may be executed by this API. */
const QUERY_NAMES = [
  'dataset_bounds',
  'queue_stats',
  'overview_summary',
  'overview_contact_reasons',
  'overview_changes',
  'daily_activity',
  'explore_interactions',
  'explore_count',
  'call_detail',
  'call_segments',
  'call_key_moments',
  'call_themes',
  'themes_list',
  'theme_breakdown',
  'theme_calls',
] as const;
export type InsightsQueryName = (typeof QUERY_NAMES)[number];
export const PAGE_SIZE = 25;

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value))
  .or(z.literal(''));
const scopeSchema = z
  .object({
    queue: z.string().trim().max(120).default(''),
    start: day.default(''),
    end: day.default(''),
  })
  .refine((value) => !value.start || !value.end || value.start <= value.end, { message: 'Start must precede end.' });
const exploreSchema = z.object({
  q: z.string().max(200).default(''),
  reason: z.string().max(200).default(''),
  sentiment: z.enum(['', 'negative', 'neutral', 'positive']).default(''),
  theme: z.string().max(80).default(''),
  silence: z.enum(['', '0', '1', 'true', 'false']).default(''),
  page: z.coerce.number().int().min(1).max(4000).default(1),
});
const changesSchema = z.object({
  min_calls: z.coerce.number().int().min(1).max(100000).default(3),
  threshold: z.coerce.number().min(0.05).max(10).default(0.25),
});
const themeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const interactionIdSchema = z.string().trim().min(1).max(200);

export function parseScope(query: unknown): Scope {
  const input = z.record(z.string(), z.unknown()).parse(query ?? {});
  const picked = { queue: first(input.queue), start: first(input.start), end: first(input.end) };
  const scope = scopeSchema.parse(picked);
  return { queue: scope.queue === 'all' ? '' : scope.queue, start: scope.start, end: scope.end };
}
function first(value: unknown): unknown {
  return Array.isArray(value) ? (value as unknown[])[0] : value;
}
function flat(query: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(z.record(z.string(), z.unknown()).parse(query ?? {})).map(([k, v]) => [k, first(v)]));
}
/** Warehouse scalars as text; structured values are never stringified. */
const asText = (value: unknown, fallback = ''): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
      ? String(value)
      : fallback;

const num = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const int = (value: unknown) => num(value) ?? 0;
const str = (value: unknown): string | null => {
  const text = asText(value);
  return text === '' ? null : text;
};
const bool = (value: unknown): boolean | null => (value == null ? null : value === true || value === 'true');
const date = (value: unknown) => {
  const text = str(value);
  if (!text) return '';
  const parsed = new Date(text.includes('T') || text.includes(' ') ? text.replace(' ', 'T') : `${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : parsed.toISOString().slice(0, 10);
};
const iso = (value: unknown) => {
  const text = str(value);
  if (!text) return null;
  const parsed = new Date(text.includes('T') ? text : text.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? '' : 'Z'));
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
};
/** The warehouse returns the day after the last included day as period_end. */
const inclusiveEnd = (value: unknown) => {
  const text = date(value);
  if (!text) return '';
  const parsed = new Date(`${text}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
};

function isMissingTable(error: unknown) {
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  const message = `${error instanceof Error ? error.message : asText(error)} ${cause instanceof Error ? cause.message : asText(cause)}`;
  return /TABLE_OR_VIEW_NOT_FOUND|cannot be found|does not exist/i.test(message);
}

export function createInsightsQueries(appkit: InsightsAnalytics, root = process.cwd()) {
  const sources = new Map<InsightsQueryName, Promise<string>>();
  return async function run(req: IAppRequest, name: InsightsQueryName, params: Params = {}): Promise<Row[]> {
    if (!QUERY_NAMES.includes(name)) throw new HttpError(400, 'Unknown query.');
    let text = sources.get(name);
    if (!text) {
      text = readFile(resolve(root, 'config', 'queries', `${name}.obo.sql`), 'utf8');
      sources.set(name, text);
    }
    const result = await appkit.asUser(req).analytics.query(await text, params);
    // A successful zero-row statement omits its data array.
    return z.object({ data: z.array(z.record(z.string(), z.unknown())).default([]) }).parse(result ?? {}).data;
  };
}
export type InsightsQueryRunner = ReturnType<typeof createInsightsQueries>;

const scopeParams = (scope: Scope): Params => ({
  queue: sql.string(scope.queue),
  start_date: sql.string(scope.start),
  end_date: sql.string(scope.end),
});

export async function loadBounds(run: InsightsQueryRunner, req: IAppRequest): Promise<Bounds> {
  const [bounds, queues] = await Promise.all([run(req, 'dataset_bounds'), run(req, 'queue_stats')]);
  const row = bounds[0] ?? {};
  return {
    minDate: date(row.min_started_at),
    maxDate: date(row.max_started_at),
    calls: int(row.interaction_count),
    recordingDays: int(row.recording_days),
    queues: queues.map((q) => asText(q.queue)).filter(Boolean).sort(),
  };
}

export async function loadOverview(run: InsightsQueryRunner, req: IAppRequest, scope: Scope): Promise<OverviewData> {
  const params = scopeParams(scope);
  const [summaryRows, reasons, daily] = await Promise.all([
    run(req, 'overview_summary', params),
    run(req, 'overview_contact_reasons', params),
    run(req, 'daily_activity', params),
  ]);
  const s = summaryRows[0] ?? {};
  return {
    periodStart: date(s.period_start),
    periodEnd: inclusiveEnd(s.period_end),
    previousStart: date(s.previous_period_start),
    calls: int(s.interaction_count),
    previousCalls: int(s.previous_interaction_count),
    agents: int(s.agent_count),
    enriched: int(s.enriched_count),
    avgDurationSeconds: num(s.avg_duration_seconds),
    previousAvgDurationSeconds: num(s.previous_avg_duration_seconds),
    sentimentEvaluated: int(s.sentiment_count),
    previousSentimentEvaluated: int(s.previous_sentiment_count),
    negativeShare: num(s.negative_share),
    previousNegativeShare: num(s.previous_negative_share),
    repeatEvaluated: int(s.repeat_evaluated_count),
    previousRepeatEvaluated: int(s.previous_repeat_evaluated_count),
    repeatShare: num(s.repeat_share),
    previousRepeatShare: num(s.previous_repeat_share),
    latestProcessedAt: iso(s.latest_processed_at),
    daily: daily.map((d) => ({ date: date(d.day), calls: int(d.interaction_count), negativeShare: num(d.negative_share) })),
    reasons: reasons.map((r) => ({
      name: asText(r.contact_reason),
      calls: int(r.interaction_count),
      avgDurationSeconds: num(r.avg_duration_seconds),
      negative: int(r.negative_count),
    })),
  };
}

export async function loadChanges(
  run: InsightsQueryRunner,
  req: IAppRequest,
  scope: Scope,
  options: { minCalls: number; threshold: number }
): Promise<ChangesData> {
  const params = scopeParams(scope);
  const summary = (await run(req, 'overview_summary', params))[0] ?? {};
  const previousCalls = int(summary.previous_interaction_count);
  const base = { previousStart: date(summary.previous_period_start), previousCalls, threshold: options.threshold, minCalls: options.minCalls };
  if (!previousCalls) return { comparable: false, ...base, changes: [] };
  const rows = await run(req, 'overview_changes', {
    ...params,
    min_calls: sql.int(options.minCalls),
    threshold: sql.double(options.threshold),
  });
  return {
    comparable: true,
    ...base,
    changes: rows.map((r) => ({
      kind: r.kind === 'theme' || r.kind === 'label' ? r.kind : 'reason',
      id: asText(r.id),
      name: asText(r.name ?? r.id),
      current: int(r.current_count),
      previous: int(r.previous_count),
      currentShare: num(r.current_share) ?? 0,
      previousShare: num(r.previous_share) ?? 0,
      changePct: num(r.change_pct) ?? 0,
      currentAvgDurationSeconds: num(r.current_avg_duration_seconds),
      previousAvgDurationSeconds: num(r.previous_avg_duration_seconds),
      topQueue: str(r.top_queue),
      topQueueShare: num(r.top_queue_share),
    })),
  };
}

export async function loadExplore(
  run: InsightsQueryRunner,
  req: IAppRequest,
  scope: Scope,
  filters: z.infer<typeof exploreSchema>
): Promise<ExploreData> {
  const params: Params = {
    ...scopeParams(scope),
    search_text: sql.string(filters.q.trim()),
    contact_reason: sql.string(filters.reason),
    sentiment: sql.string(filters.sentiment),
    min_silence: sql.double(filters.silence === '1' || filters.silence === 'true' ? 10 : 0),
    enriched_only: sql.string('false'),
    theme_id: sql.string(filters.theme),
  };
  const [rows, counts] = await Promise.all([
    run(req, 'explore_interactions', { ...params, page_size: sql.int(PAGE_SIZE), row_offset: sql.int((filters.page - 1) * PAGE_SIZE) }),
    run(req, 'explore_count', params),
  ]);
  const c = counts[0] ?? {};
  return {
    rows: rows.map((r) => ({
      id: asText(r.interaction_id),
      startedAt: iso(r.started_at) ?? '',
      queue: asText(r.queue),
      agentName: asText(r.agent_name),
      durationSeconds: int(r.duration_seconds),
      longestSilenceSeconds: num(r.longest_silence_seconds),
      contactReason: str(r.contact_reason),
      sentimentEnd: str(r.sentiment_end),
      resolution: str(r.resolution_status),
      enrichment: r.enrichment_status === 'complete' || r.enrichment_status === 'failed' ? r.enrichment_status : 'pending',
      masking: r.masking_state === 'complete' || r.masking_state === 'partial' ? r.masking_state : 'pending',
      matchText: str(r.matched_text),
      matchStart: num(r.match_start_seconds),
    })),
    total: int(c.total_count),
    scopeTotal: int(c.scope_count),
    scopeEnriched: int(c.scope_enriched_count),
    maskedComplete: int(c.masked_complete_count),
    pageSize: PAGE_SIZE,
    latestProcessedAt: iso(c.latest_processed_at),
  };
}

export async function loadCall(run: InsightsQueryRunner, req: IAppRequest, id: string): Promise<CallDetail> {
  const params = { interaction_id: sql.string(id) };
  const [detail, segments, moments, themes] = await Promise.all([
    run(req, 'call_detail', params),
    run(req, 'call_segments', params),
    run(req, 'call_key_moments', params),
    run(req, 'call_themes', params).catch((error: unknown) => {
      if (isMissingTable(error)) return [] as Row[];
      throw error;
    }),
  ]);
  const d = detail[0];
  if (!d) throw new HttpError(404, 'The conversation is unavailable or access is restricted.');
  const enriched = bool(d.is_enriched) === true;
  return {
    id: asText(d.interaction_id),
    startedAt: iso(d.started_at) ?? '',
    durationSeconds: num(d.duration_seconds) ?? 0,
    queue: asText(d.queue),
    agentName: asText(d.agent_name),
    enriched,
    summary: enriched ? str(d.summary) : null,
    contactReason: enriched ? str(d.contact_reason) : null,
    sentimentStart: enriched ? str(d.sentiment_start) : null,
    sentimentEnd: enriched ? str(d.sentiment_end) : null,
    resolution: enriched ? str(d.resolution_status) : null,
    repeatContactMentioned: enriched ? bool(d.repeat_contact_mentioned) : null,
    transferCount: enriched ? num(d.transfer_count) : null,
    talkRatioAgent: num(d.talk_ratio_agent),
    longestSilenceSeconds: num(d.longest_silence_seconds),
    overtalkCount: num(d.overtalk_count),
    holdCount: num(d.hold_count),
    themes: themes.map((t) => ({ id: asText(t.theme_id), name: asText(t.name ?? t.theme_id) })),
    segments: segments.map((s) => ({
      idx: int(s.segment_idx),
      start: num(s.start_seconds) ?? 0,
      end: num(s.end_seconds) ?? 0,
      role: asText(s.speaker_role, 'unknown'),
      // Withheld (unmasked) turns are never sent as text.
      text: bool(s.is_masked) ? str(s.text) : null,
    })),
    moments: moments.map((m) => ({
      label: asText(m.label),
      start: num(m.start_seconds) ?? 0,
      quote: str(m.quote),
      grounded: bool(m.grounded) === true,
    })),
    audio: Boolean(str(d.audio_path)),
  };
}

function themeRun(row: Row): ThemeRun {
  return {
    id: asText(row.run_id),
    createdAt: iso(row.run_created_at) ?? '',
    method: asText(row.run_method),
    callsThemed: int(row.run_calls_themed),
    purity: num(row.run_purity),
  };
}
function themeSummary(row: Row): ThemeSummary {
  return {
    id: asText(row.theme_id),
    name: asText(row.name ?? row.theme_id),
    description: asText(row.description),
    calls: int(row.calls),
    previousCalls: int(row.previous_calls),
    avgDurationSeconds: num(row.avg_duration_seconds),
    negative: int(row.negative),
    sentimentEvaluated: int(row.sentiment_evaluated),
    repeatMentions: int(row.repeat_mentions),
    repeatEvaluated: int(row.repeat_evaluated),
    topQueue: str(row.top_queue),
  };
}

export async function loadThemes(run: InsightsQueryRunner, req: IAppRequest, scope: Scope): Promise<ThemesData> {
  const rows = await run(req, 'themes_list', scopeParams(scope));
  if (!rows.length) return { run: null, callsInScope: 0, themedInScope: 0, themes: [] };
  return {
    run: themeRun(rows[0]),
    callsInScope: int(rows[0].calls_in_scope),
    themedInScope: int(rows[0].themed_in_scope),
    themes: rows.map(themeSummary),
  };
}

export async function loadTheme(run: InsightsQueryRunner, req: IAppRequest, scope: Scope, id: string): Promise<ThemeDetail> {
  const params = { ...scopeParams(scope), theme_id: sql.string(id) };
  const [list, breakdown, calls] = await Promise.all([
    run(req, 'themes_list', scopeParams(scope)),
    run(req, 'theme_breakdown', params),
    run(req, 'theme_calls', params),
  ]);
  const row = list.find((r) => asText(r.theme_id) === id);
  if (!row) throw new HttpError(404, 'This theme is not part of the current theme run.');
  const by = (dimension: string) => breakdown.filter((b) => b.dimension === dimension);
  return {
    run: themeRun(row),
    callsInScope: int(row.calls_in_scope),
    theme: themeSummary(row),
    byQueue: by('queue').map((b) => ({ queue: asText(b.value), calls: int(b.calls), avgDurationSeconds: num(b.avg_duration_seconds) })),
    reasons: by('reason').map((b) => ({ name: asText(b.value), calls: int(b.calls) })),
    daily: by('day')
      .map((b) => ({ date: asText(b.value), calls: int(b.calls) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    representatives: calls.map((c) => ({
      id: asText(c.interaction_id),
      startedAt: iso(c.started_at) ?? '',
      queue: asText(c.queue),
      durationSeconds: num(c.duration_seconds) ?? 0,
      sentimentEnd: str(c.sentiment_end),
      excerpt: str(c.excerpt),
      excerptStart: num(c.excerpt_start),
    })),
  };
}

const notSetUp = (feature: string) =>
  new HttpError(
    503,
    `${feature} is not set up in this workspace yet. Run resources/theme-tables.sql and resources/label-tracking.sql, then the theme builder job.`
  );

/** Read-only, per-user analytics API used by the client's live data source. */
export function registerInsightsRoutes(app: Router, run: InsightsQueryRunner) {
  const handle =
    (work: (req: IAppRequest) => Promise<unknown>, feature?: string) =>
    async (req: IAppRequest, res: import('express').Response) => {
      try {
        // Every handler fails closed on its own; no route depends on shared middleware.
        res.setHeader('Cache-Control', 'private, no-store');
        requestActor(req);
        res.json(await work(req));
      } catch (error) {
        respondError(res, feature && isMissingTable(error) ? notSetUp(feature) : error);
      }
    };
  app.get('/api/insights/bounds', handle((req) => loadBounds(run, req)));
  app.get('/api/insights/overview', handle((req) => loadOverview(run, req, parseScope(req.query))));
  app.get(
    '/api/insights/changes',
    handle((req) => {
      const options = changesSchema.parse(flat(req.query));
      return loadChanges(run, req, parseScope(req.query), { minCalls: options.min_calls, threshold: options.threshold });
    }, "What's changed")
  );
  app.get(
    '/api/insights/explore',
    handle((req) => {
      const filters = exploreSchema.parse(flat(req.query));
      if (filters.theme) themeIdSchema.parse(filters.theme);
      return loadExplore(run, req, parseScope(req.query), filters);
    }, 'Theme filtering')
  );
  app.get('/api/insights/calls/:id', handle((req) => loadCall(run, req, interactionIdSchema.parse(req.params.id))));
  app.get('/api/insights/themes', handle((req) => loadThemes(run, req, parseScope(req.query)), 'Themes'));
  app.get(
    '/api/insights/themes/:id',
    handle((req) => loadTheme(run, req, parseScope(req.query), themeIdSchema.parse(req.params.id)), 'Themes')
  );
}
