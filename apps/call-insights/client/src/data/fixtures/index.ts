import type {
  CallDetail,
  Change,
  ChangesData,
  ExploreData,
  ExploreFilters,
  LabelTracking,
  OverviewData,
  Scope,
  ThemeDetail,
  ThemesData,
  ThemeSummary,
} from '../../../../shared/insights';
import type { EvidenceInput, Investigation, InvestigationSummary } from '../../../../shared/investigations';
import type { IntelligenceLabel, LabelInput, LabelResult, LabelRevision, LabelRun, RunEstimate } from '../../../../shared/intelligence';
import { maskedText } from '../../lib/privacy';
import { DataError, type BreakdownRow, type DataSource, type LabelSummaryRow, type TrackingStatusRow } from '../source';
import { INITIAL_CASES, INITIAL_LABELS, INTERACTIONS, QUEUES, THEMES } from './data';
import type { Interaction } from './types';

/** Offline data source over the fictional HarperValleyBank-style fixtures. Nothing leaves the browser. */
const MAX_DATE = '2026-10-22';
const MIN_DATE = INTERACTIONS.map((c) => c.startedAt.slice(0, 10)).sort()[0] ?? MAX_DATE;
const OWNER = 'demo.analyst@example.com';
const STORE_KEY = 'call-insights.fixtures.v2';
const PAGE_SIZE = 10;

const delay = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(structuredClone(value)), 120));
const fail = (message: string, status = 404) => Promise.reject(new DataError(message, status));
const day = (call: Interaction) => call.startedAt.slice(0, 10);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (value: string, days: number) => {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const avg = (values: number[]) => (values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10 : null);
const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 1000 : null);

function window(scope: Scope) {
  const start = scope.start || MIN_DATE;
  const end = scope.end || MAX_DATE;
  const length = daysBetween(start, end) + 1;
  return { start, end, previousStart: addDays(start, -length), previousEnd: addDays(start, -1) };
}
function calls(scope: Scope, period: 'current' | 'previous' = 'current') {
  const w = window(scope);
  const [from, to] = period === 'current' ? [w.start, w.end] : [w.previousStart, w.previousEnd];
  return INTERACTIONS.filter((c) => (!scope.queue || c.queue === scope.queue) && day(c) >= from && day(c) <= to);
}
const firstCustomer = (call: Interaction) =>
  call.segments.find((s) => s.role === 'customer' && maskedText(s.text).length > 40 && !maskedText(s.text).includes('[account number hidden]')) ??
  call.segments[0];

// ---- persisted fixture state (cases, labels, runs) -------------------------------------------

type RunRecord = LabelRun & { results: LabelResult[] };
type State = {
  cases: Investigation[];
  labels: IntelligenceLabel[];
  runs: RunRecord[];
  tracking: Record<string, { enabled: boolean; version: number; enabledAt: string }>;
};

function excerptFor(callId: string, start: number, end: number) {
  const call = INTERACTIONS.find((c) => c.id === callId);
  if (!call) return { text: '', queue: '', startedAt: '' };
  const text = call.segments
    .filter((s) => s.end > start && s.start < end)
    .map((s) => maskedText(s.text))
    .join(' ');
  return { text, queue: call.queue, startedAt: call.startedAt };
}
function withExcerpts(record: Investigation): Investigation {
  const excerpts: Investigation['excerpts'] = {};
  for (const item of record.items)
    if (item.type === 'clip' && item.interactionId) excerpts[item.id] = excerptFor(item.interactionId, item.start ?? 0, item.end ?? 0);
  return { ...record, excerpts };
}
function revisionFrom(label: (typeof INITIAL_LABELS)[number], version: number): LabelRevision {
  return {
    name: label.name,
    definition: label.definition,
    includeExamples: label.includeExamples,
    excludeExamples: label.excludeExamples,
    speakerFocus: label.speakerFocus,
    queue: '',
    startDate: '1900-01-01',
    endDate: '9999-12-31',
    version,
    createdAt: `${label.lastRun}T09:00:00.000Z`,
    promptHash: `fixture-${label.id}-${version}`,
  };
}
function resultFor(call: Interaction, label: { id: string; definition: string }): LabelResult {
  const terms = label.definition
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 5);
  const tagged = call.labels.includes(label.id);
  const hit = call.segments.find((s) => terms.some((t) => s.text.toLowerCase().includes(t)));
  const matched = tagged || (!!hit && !INITIAL_LABELS.some((l) => l.id === label.id));
  const evidence = matched ? (hit ?? firstCustomer(call)) : undefined;
  return {
    interaction_id: call.id,
    queue: call.queue,
    agent_name: call.agentName,
    started_at: call.startedAt,
    matched,
    confidence: matched ? 'medium' : 'high',
    evidence_quote: evidence ? maskedText(evidence.text) : '',
    evidence_start_seconds: evidence?.start ?? -1,
    grounded: Boolean(evidence),
    reason: matched ? 'Simulated fixture result: the transcript contains the described pattern.' : 'Simulated fixture result: no matching moment.',
    error_message: '',
    verdict: '',
  };
}
function newRun(labelId: string, version: number, type: 'sample' | 'full' | 'tracking', results: LabelResult[], startedAt = new Date().toISOString()): RunRecord {
  return {
    run_id: crypto.randomUUID(),
    label_id: labelId,
    version,
    run_type: type,
    status: 'completed',
    interactions_in_scope: results.length,
    processed_count: results.length,
    matched_count: results.filter((r) => r.matched).length,
    error_count: 0,
    ungrounded_count: results.filter((r) => r.matched && !r.grounded).length,
    estimated_tokens: results.length * 900,
    started_at: startedAt,
    finished_at: startedAt,
    model_endpoint: 'fixture-simulation',
    error_message: '',
    job_run_id: '',
    results,
  };
}
function initialState(): State {
  const labels: IntelligenceLabel[] = INITIAL_LABELS.map((label) => ({
    id: label.id,
    currentVersion: label.version,
    versions: Array.from({ length: label.version }, (_, i) => revisionFrom(label, i + 1)),
    ownerEmail: OWNER,
    documentVersion: 1,
    updatedAt: `${label.lastRun}T09:00:00.000Z`,
  }));
  const runs: RunRecord[] = [];
  const tracking: State['tracking'] = {};
  for (const label of INITIAL_LABELS) {
    if (label.status === 'draft') continue;
    const sample = label.sample.map((s) => {
      const call = INTERACTIONS.find((c) => c.id === s.interactionId)!;
      return {
        ...resultFor(call, label),
        matched: s.matched,
        confidence: s.confidence,
        evidence_quote: maskedText(s.evidenceQuote),
        evidence_start_seconds: s.evidenceStart,
        grounded: s.grounded,
        reason: s.reason,
        verdict: s.verdict ?? '',
      };
    });
    runs.push(newRun(label.id, label.version, 'sample', sample, `${label.lastRun}T08:00:00.000Z`));
    if (label.status === 'ran' || label.status === 'active' || label.tracked)
      runs.push(newRun(label.id, label.version, 'full', INTERACTIONS.map((c) => resultFor(c, label)), `${label.lastRun}T09:00:00.000Z`));
    if (label.tracked) tracking[label.id] = { enabled: true, version: label.version, enabledAt: `${label.lastRun}T09:30:00.000Z` };
  }
  const cases: Investigation[] = INITIAL_CASES.map((c) => ({
    id: c.id,
    title: c.title,
    question: '',
    ownerEmail: OWNER,
    sharedWith: [],
    createdAt: `${c.updatedAt}T09:00:00.000Z`,
    updatedAt: `${c.updatedAt}T09:00:00.000Z`,
    version: 1,
    canEdit: true,
    excerpts: {},
    items: c.items.map((item) => ({
      id: item.id,
      type: item.type === 'clip' ? 'clip' : item.type === 'theme' ? 'theme' : 'note',
      interactionId: item.type === 'clip' ? item.refId : undefined,
      start: item.start,
      end: item.end,
      refId: item.type === 'theme' ? item.refId : undefined,
      title: item.type === 'theme' ? THEMES.find((t) => t.id === item.refId)?.name : undefined,
      note: item.note,
      createdBy: OWNER,
      createdAt: `${c.updatedAt}T09:00:00.000Z`,
    })),
  }));
  return { cases, labels, runs, tracking };
}
let memory: State | null = null;
function state(): State {
  if (memory) return memory;
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as State | null;
    if (stored && Array.isArray(stored.cases) && Array.isArray(stored.labels) && Array.isArray(stored.runs)) memory = stored;
  } catch {
    /* Unavailable storage starts from the fixtures. */
  }
  memory ??= initialState();
  return memory;
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(memory));
  } catch {
    /* Session-only when storage is unavailable. */
  }
}
export function resetFixtures() {
  memory = initialState();
  save();
}

// ---- analytics -------------------------------------------------------------------------------

function themeSummaries(scope: Scope): ThemeSummary[] {
  const current = calls(scope);
  const previous = calls(scope, 'previous');
  return THEMES.map((theme) => {
    const members = current.filter((c) => c.themes.includes(theme.id));
    const queueCounts = new Map<string, number>();
    for (const c of members) queueCounts.set(c.queue, (queueCounts.get(c.queue) ?? 0) + 1);
    return {
      id: theme.id,
      name: theme.name,
      description: theme.summary,
      calls: members.length,
      previousCalls: previous.filter((c) => c.themes.includes(theme.id)).length,
      avgDurationSeconds: avg(members.map((c) => c.durationSeconds)),
      negative: members.filter((c) => c.sentimentEnd === 'negative').length,
      sentimentEvaluated: members.length,
      repeatMentions: members.filter((c) => c.repeatContact).length,
      repeatEvaluated: members.length,
      topQueue: [...queueCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null,
    };
  }).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}
const FIXTURE_RUN = { id: 'fixture-themes', createdAt: `${MAX_DATE}T06:00:00.000Z`, method: 'Hand-authored fixture themes', callsThemed: INTERACTIONS.filter((c) => c.themes.length).length, purity: null };

function changesFor(scope: Scope, minCalls: number, threshold: number): Change[] {
  const current = calls(scope);
  const previous = calls(scope, 'previous');
  type Item = { kind: Change['kind']; id: string; name: string; hit: (c: Interaction) => boolean; evaluated: (c: Interaction) => boolean };
  const tracked = Object.entries(state().tracking).filter(([, t]) => t.enabled);
  const items: Item[] = [
    ...[...new Set(INTERACTIONS.map((c) => c.contactReason))].map((reason) => ({
      kind: 'reason' as const,
      id: reason,
      name: reason,
      hit: (c: Interaction) => c.contactReason === reason,
      evaluated: () => true,
    })),
    ...THEMES.map((t) => ({ kind: 'theme' as const, id: t.id, name: t.name, hit: (c: Interaction) => c.themes.includes(t.id), evaluated: (c: Interaction) => c.themes.length > 0 })),
    ...tracked.map(([id]) => ({
      kind: 'label' as const,
      id,
      name: state().labels.find((l) => l.id === id)?.versions.at(-1)?.name ?? id,
      hit: (c: Interaction) => c.labels.includes(id),
      evaluated: () => true,
    })),
  ];
  const out: Change[] = [];
  for (const item of items) {
    const cur = current.filter(item.hit);
    const prev = previous.filter(item.hit);
    const curShare = cur.length / Math.max(1, current.filter(item.evaluated).length);
    const prevShare = prev.length / Math.max(1, previous.filter(item.evaluated).length);
    if (!prev.length || cur.length < minCalls) continue;
    const changePct = (curShare - prevShare) / prevShare;
    if (Math.abs(changePct) < threshold) continue;
    const queues = new Map<string, number>();
    for (const c of cur) queues.set(c.queue, (queues.get(c.queue) ?? 0) + 1);
    const top = [...queues].sort((a, b) => b[1] - a[1])[0];
    out.push({
      kind: item.kind,
      id: item.id,
      name: item.name,
      current: cur.length,
      previous: prev.length,
      currentShare: curShare,
      previousShare: prevShare,
      changePct: Math.round(changePct * 1000) / 1000,
      currentAvgDurationSeconds: avg(cur.map((c) => c.durationSeconds)),
      previousAvgDurationSeconds: avg(prev.map((c) => c.durationSeconds)),
      topQueue: top?.[0] ?? null,
      topQueueShare: top ? top[1] / cur.length : null,
    });
  }
  return out.sort((a, b) => Math.abs(b.changePct) * b.current - Math.abs(a.changePct) * a.current).slice(0, 12);
}

function toCall(call: Interaction): CallDetail {
  return {
    id: call.id,
    startedAt: new Date(`${call.startedAt}Z`).toISOString(),
    durationSeconds: call.durationSeconds,
    queue: call.queue,
    agentName: call.agentName,
    enriched: true,
    summary: maskedText(call.summary),
    contactReason: call.contactReason,
    sentimentStart: call.sentimentStart,
    sentimentEnd: call.sentimentEnd,
    resolution: call.resolution,
    repeatContactMentioned: call.repeatContact,
    transferCount: call.transferCount,
    talkRatioAgent: call.talkRatioAgent,
    longestSilenceSeconds: call.longestSilence,
    overtalkCount: call.overtalkCount,
    holdCount: call.holdCount,
    themes: call.themes.map((id) => ({ id, name: THEMES.find((t) => t.id === id)?.name ?? id })),
    segments: call.segments.map((s) => ({ idx: s.idx, start: s.start, end: s.end, role: s.role, text: maskedText(s.text) })),
    moments: call.keyMoments.map((m) => {
      const source = call.segments.find((s) => s.text.includes(m.quote));
      return { label: m.label, start: source?.start ?? m.start, quote: source ? maskedText(m.quote) : null, grounded: Boolean(source) };
    }),
    audio: false,
  };
}

function exploreRows(scope: Scope, filters: ExploreFilters) {
  const keyword = filters.q.trim().toLowerCase();
  return calls(scope)
    .filter((c) => !filters.reason || c.contactReason === filters.reason)
    .filter((c) => !filters.sentiment || c.sentimentEnd === filters.sentiment)
    .filter((c) => !filters.theme || c.themes.includes(filters.theme))
    .filter((c) => !filters.silence || c.longestSilence >= 10)
    .filter((c) => !keyword || c.segments.some((s) => maskedText(s.text).toLowerCase().includes(keyword)))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id));
}

function breakdown(results: LabelResult[]): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>();
  for (const r of results)
    for (const [dimension, value] of [
      ['queue', r.queue],
      ['agent', r.agent_name],
      ['day', r.started_at.slice(0, 10)],
    ]) {
      const key = `${dimension}:${value}`;
      const row = rows.get(key) ?? { dimension, value, evaluated_count: 0, matched_count: 0, error_count: 0 };
      row.evaluated_count += 1;
      if (r.matched) row.matched_count += 1;
      rows.set(key, row);
    }
  return [...rows.values()].sort((a, b) => a.dimension.localeCompare(b.dimension) || b.matched_count - a.matched_count);
}

function trackingFor(id: string): LabelTracking {
  const t = state().tracking[id];
  const latest = new Map<string, LabelResult>();
  for (const run of state().runs.filter((r) => r.label_id === id && r.version === t?.version && r.run_type !== 'sample'))
    for (const result of run.results) latest.set(result.interaction_id, result);
  const byDay = new Map<string, { evaluated: number; matched: number }>();
  for (const r of latest.values()) {
    const key = r.started_at.slice(0, 10);
    const point = byDay.get(key) ?? { evaluated: 0, matched: 0 };
    point.evaluated += 1;
    if (r.matched) point.matched += 1;
    byDay.set(key, point);
  }
  return {
    enabled: Boolean(t?.enabled),
    version: t?.version ?? null,
    enabledAt: t?.enabledAt ?? null,
    lastRunAt: t?.enabled ? t.enabledAt : null,
    points: t ? [...byDay].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v })) : [],
  };
}

function ownLabel(id: string) {
  const label = state().labels.find((l) => l.id === id);
  if (!label) throw new DataError('Label not found.', 404);
  return label;
}
function revisionOf(label: IntelligenceLabel, version: number) {
  const revision = label.versions.find((v) => v.version === version);
  if (!revision) throw new DataError('Label version not found.', 404);
  return revision;
}
function scopedCalls(revision: LabelRevision) {
  return INTERACTIONS.filter(
    (c) => (!revision.queue || c.queue === revision.queue) && day(c) >= revision.startDate && day(c) <= revision.endDate
  );
}

export function createFixtureSource(): DataSource {
  const source: DataSource = {
    mode: 'fixtures',
    describe: 'Fictional sample data · stored in this browser',
    identity: () => delay({ email: OWNER, name: 'Demo analyst' }),
    bounds: () =>
      delay({
        minDate: MIN_DATE,
        maxDate: MAX_DATE,
        calls: INTERACTIONS.length,
        recordingDays: new Set(INTERACTIONS.map(day)).size,
        queues: [...QUEUES].sort(),
      }),
    overview(scope): Promise<OverviewData> {
      const w = window(scope);
      const current = calls(scope);
      const previous = calls(scope, 'previous');
      const reasons = new Map<string, Interaction[]>();
      for (const c of current) reasons.set(c.contactReason, [...(reasons.get(c.contactReason) ?? []), c]);
      const length = daysBetween(w.start, w.end) + 1;
      return delay({
        periodStart: w.start,
        periodEnd: w.end,
        previousStart: w.previousStart,
        calls: current.length,
        previousCalls: previous.length,
        agents: new Set(current.map((c) => c.agentId)).size,
        enriched: current.length,
        avgDurationSeconds: avg(current.map((c) => c.durationSeconds)),
        previousAvgDurationSeconds: avg(previous.map((c) => c.durationSeconds)),
        sentimentEvaluated: current.length,
        previousSentimentEvaluated: previous.length,
        negativeShare: share(current.filter((c) => c.sentimentEnd === 'negative').length, current.length),
        previousNegativeShare: share(previous.filter((c) => c.sentimentEnd === 'negative').length, previous.length),
        repeatEvaluated: current.length,
        previousRepeatEvaluated: previous.length,
        repeatShare: share(current.filter((c) => c.repeatContact).length, current.length),
        previousRepeatShare: share(previous.filter((c) => c.repeatContact).length, previous.length),
        latestProcessedAt: `${MAX_DATE}T06:00:00.000Z`,
        daily: Array.from({ length }, (_, i) => {
          const date = addDays(w.start, i);
          const dayCalls = current.filter((c) => day(c) === date);
          return { date, calls: dayCalls.length, negativeShare: share(dayCalls.filter((c) => c.sentimentEnd === 'negative').length, dayCalls.length) };
        }).filter((d) => d.calls > 0),
        reasons: [...reasons]
          .map(([name, list]) => ({ name, calls: list.length, avgDurationSeconds: avg(list.map((c) => c.durationSeconds)), negative: list.filter((c) => c.sentimentEnd === 'negative').length }))
          .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)),
      });
    },
    changes(scope): Promise<ChangesData> {
      const previous = calls(scope, 'previous');
      const w = window(scope);
      const base = { previousStart: w.previousStart, previousCalls: previous.length, threshold: 0.25, minCalls: 1 };
      return delay(previous.length ? { comparable: true, ...base, changes: changesFor(scope, 1, 0.25) } : { comparable: false, ...base, changes: [] });
    },
    explore(scope, filters): Promise<ExploreData> {
      const rows = exploreRows(scope, filters);
      const keyword = filters.q.trim().toLowerCase();
      const page = rows.slice((filters.page - 1) * PAGE_SIZE, filters.page * PAGE_SIZE);
      return delay({
        rows: page.map((c) => {
          const match = keyword ? c.segments.find((s) => maskedText(s.text).toLowerCase().includes(keyword)) : firstCustomer(c);
          return {
            id: c.id,
            startedAt: new Date(`${c.startedAt}Z`).toISOString(),
            queue: c.queue,
            agentName: c.agentName,
            durationSeconds: c.durationSeconds,
            longestSilenceSeconds: c.longestSilence,
            contactReason: c.contactReason,
            sentimentEnd: c.sentimentEnd,
            resolution: c.resolution,
            enrichment: 'complete' as const,
            masking: 'complete' as const,
            matchText: match ? maskedText(match.text) : null,
            matchStart: match?.start ?? null,
          };
        }),
        total: rows.length,
        scopeTotal: calls(scope).length,
        scopeEnriched: calls(scope).length,
        maskedComplete: rows.length,
        pageSize: PAGE_SIZE,
        latestProcessedAt: `${MAX_DATE}T06:00:00.000Z`,
      });
    },
    call(id) {
      const call = INTERACTIONS.find((c) => c.id === id);
      return call ? delay(toCall(call)) : fail('Call not found in the fixture data.');
    },
    audioUrl: () => null,
    themes(scope): Promise<ThemesData> {
      const current = calls(scope);
      return delay({
        run: FIXTURE_RUN,
        callsInScope: current.length,
        themedInScope: current.filter((c) => c.themes.length).length,
        themes: themeSummaries(scope),
      });
    },
    theme(scope, id): Promise<ThemeDetail> {
      const theme = themeSummaries(scope).find((t) => t.id === id);
      if (!theme) return fail('This theme is not part of the fixture data.');
      const members = calls(scope).filter((c) => c.themes.includes(id));
      const group = <K extends string>(key: (c: Interaction) => K) => {
        const map = new Map<K, Interaction[]>();
        for (const c of members) map.set(key(c), [...(map.get(key(c)) ?? []), c]);
        return [...map];
      };
      return delay({
        run: FIXTURE_RUN,
        callsInScope: calls(scope).length,
        theme,
        byQueue: group((c) => c.queue)
          .map(([queue, list]) => ({ queue, calls: list.length, avgDurationSeconds: avg(list.map((c) => c.durationSeconds)) }))
          .sort((a, b) => b.calls - a.calls),
        reasons: group((c) => c.contactReason)
          .map(([name, list]) => ({ name, calls: list.length }))
          .sort((a, b) => b.calls - a.calls),
        daily: group((c) => day(c))
          .map(([date, list]) => ({ date, calls: list.length }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        representatives: members.map((c) => {
          const excerpt = firstCustomer(c);
          return {
            id: c.id,
            startedAt: new Date(`${c.startedAt}Z`).toISOString(),
            queue: c.queue,
            durationSeconds: c.durationSeconds,
            sentimentEnd: c.sentimentEnd,
            excerpt: excerpt ? maskedText(excerpt.text) : null,
            excerptStart: excerpt?.start ?? null,
          };
        }),
      });
    },
    cases: {
      list(): Promise<InvestigationSummary[]> {
        return delay(
          state().cases.map((c) => ({
            id: c.id,
            title: c.title,
            question: c.question,
            ownerEmail: c.ownerEmail,
            updatedAt: c.updatedAt,
            excerptCount: c.items.filter((i) => i.type === 'clip').length,
            noteCount: c.items.filter((i) => i.type === 'note').length,
            shared: false,
          }))
        );
      },
      get(id) {
        const record = state().cases.find((c) => c.id === id);
        return record ? delay(withExcerpts(record)) : fail('This case is not saved in this browser.');
      },
      create(title, question = '') {
        const now = new Date().toISOString();
        const record: Investigation = { id: crypto.randomUUID(), title, question, items: [], ownerEmail: OWNER, sharedWith: [], createdAt: now, updatedAt: now, version: 1, canEdit: true, excerpts: {} };
        state().cases.unshift(record);
        save();
        return delay(record);
      },
      update(id, input) {
        const record = state().cases.find((c) => c.id === id);
        if (!record) return fail('Case not found.');
        Object.assign(record, { title: input.title, question: input.question, updatedAt: new Date().toISOString(), version: record.version + 1 });
        save();
        return delay(withExcerpts(record));
      },
      addItem(id, item: EvidenceInput) {
        const record = state().cases.find((c) => c.id === id);
        if (!record) return fail('Case not found.');
        const base = { id: crypto.randomUUID(), createdBy: OWNER, createdAt: new Date().toISOString() };
        record.items.push(
          item.type === 'clip'
            ? { ...base, type: 'clip', interactionId: item.interactionId, start: item.start, end: item.end, note: item.note }
            : item.type === 'note'
              ? { ...base, type: 'note', note: item.note }
              : { ...base, type: item.type, refId: item.refId, title: item.title, scope: item.scope, note: item.note }
        );
        Object.assign(record, { updatedAt: base.createdAt, version: record.version + 1 });
        save();
        return delay(withExcerpts(record));
      },
      share() {
        return fail('Sharing needs the live workspace. Fixture cases stay in this browser.', 409);
      },
      async brief(id) {
        const record = withExcerpts(await source.cases.get(id));
        const evidence = record.items
          .map((item) => {
            if (item.type === 'clip')
              return `### ${item.interactionId} · ${item.start}–${item.end}s\n\n> ${record.excerpts[item.id]?.text ?? ''}\n\nAnalyst note: ${item.note}`;
            if (item.type === 'note') return `### Analyst note\n\n${item.note}`;
            return `### ${item.type === 'theme' ? 'Theme' : 'Label result'} · ${item.title ?? item.refId ?? ''}\n\n${item.scope ? `Scope: ${item.scope}\n\n` : ''}Analyst note: ${item.note}`;
          })
          .join('\n\n');
        return {
          filename: `${record.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'investigation'}-brief.md`,
          markdown: `# ${record.title}\n\n${record.question}\n\nOwner: ${record.ownerEmail}\nUpdated: ${record.updatedAt}\n\n## Evidence\n\n${evidence || 'No evidence collected yet.'}\n\n## Scope and limitations\n\nFictional fixture data from the offline prototype. No real calls, recordings or measured outcomes are included.\n`,
        };
      },
    },
    labels: {
      list: () => delay(state().labels),
      summary() {
        const latest: LabelSummaryRow[] = [];
        for (const label of state().labels) {
          const run = state().runs.filter((r) => r.label_id === label.id).sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
          if (!run) continue;
          latest.push({
            label_id: label.id,
            version: run.version,
            run_type: run.run_type,
            status: run.status,
            started_at: run.started_at,
            interactions_in_scope: run.interactions_in_scope,
            matched_count: run.matched_count,
            reviewed_count: run.results.filter((r) => r.verdict).length,
            correct_count: run.results.filter((r) => r.verdict === 'correct').length,
          });
        }
        const tracking: TrackingStatusRow[] = Object.entries(state().tracking).map(([label_id, t]) => ({ label_id, version: t.version, enabled: t.enabled, enabled_at: t.enabledAt, last_run_at: t.enabledAt }));
        return delay({ latest, tracking });
      },
      create(input: LabelInput) {
        const now = new Date().toISOString();
        const label: IntelligenceLabel = { id: crypto.randomUUID(), currentVersion: 1, versions: [{ ...input, version: 1, createdAt: now, promptHash: crypto.randomUUID() }], ownerEmail: OWNER, documentVersion: 1, updatedAt: now };
        state().labels.unshift(label);
        save();
        return delay(label);
      },
      async update(id, input) {
        {
          const label = ownLabel(id);
          const now = new Date().toISOString();
          label.currentVersion += 1;
          label.versions.push({ ...input, version: label.currentVersion, createdAt: now, promptHash: crypto.randomUUID() });
          Object.assign(label, { documentVersion: label.documentVersion + 1, updatedAt: now });
          save();
          return delay(label);
        }
      },
      runs: (id) => delay(state().runs.filter((r) => r.label_id === id).sort((a, b) => b.started_at.localeCompare(a.started_at)).map(({ results: _results, ...run }) => run)),
      async sample(id, version) {
        {
          const label = ownLabel(id);
          const revision = revisionOf(label, version);
          const scope = scopedCalls(revision).slice(0, 20);
          if (!scope.length) throw new DataError('No fixture calls match this label scope.', 422);
          const run = newRun(id, version, 'sample', scope.map((c) => resultFor(c, { id, definition: revision.definition })));
          state().runs.push(run);
          save();
          return delay({ runId: run.run_id, count: scope.length });
        }
      },
      async estimate(id, version): Promise<RunEstimate> {
        {
          const revision = revisionOf(ownLabel(id), version);
          const count = scopedCalls(revision).length;
          return delay({ cohortId: crypto.randomUUID(), count, estimatedTokens: count * 900, maxInteractions: 10000, modelEndpoint: 'fixture-simulation', inputCost: null, outputCost: null, costCurrency: 'USD', scope: revision, expiresAt: new Date(Date.now() + 1800000).toISOString() });
        }
      },
      async full(id, version) {
        {
          const label = ownLabel(id);
          const revision = revisionOf(label, version);
          if (!state().runs.some((r) => r.label_id === id && r.version === version && r.run_type === 'sample'))
            throw new DataError('Complete a successful sample test on this exact version before a full run.', 409);
          const scope = scopedCalls(revision);
          const run = newRun(id, version, 'full', scope.map((c) => resultFor(c, { id, definition: revision.definition })));
          state().runs.push(run);
          save();
          return delay({ runId: run.run_id, count: scope.length });
        }
      },
      results(runId, page) {
        const run = state().runs.find((r) => r.run_id === runId);
        if (!run) return fail('Run not found.');
        const sorted = [...run.results].sort((a, b) => Number(b.matched) - Number(a.matched) || a.interaction_id.localeCompare(b.interaction_id));
        return delay({ results: sorted.slice(page * 50, page * 50 + 50), breakdown: breakdown(run.results), pageSize: 50 });
      },
      async feedback(runId, interactionId, verdict) {
        const result = state().runs.find((r) => r.run_id === runId)?.results.find((r) => r.interaction_id === interactionId);
        if (!result) throw new DataError('Result not found.', 404);
        result.verdict = verdict;
        save();
        await delay(null);
      },
      tracking: (id) => delay(trackingFor(id)),
      setTracking(id, version, enabled) {
        if (enabled && !state().runs.some((r) => r.label_id === id && r.version === version && r.run_type === 'full'))
          return fail('Complete a full run on this exact version before tracking it over time.', 409);
        const previous = state().tracking[id];
        state().tracking[id] = { enabled, version, enabledAt: enabled && !(previous?.enabled && previous.version === version) ? new Date().toISOString() : previous?.enabledAt ?? new Date().toISOString() };
        save();
        return delay(trackingFor(id));
      },
    },
  };
  return source;
}
