import type { Bounds, ExploreFilters, Scope, Sentiment } from '../../../shared/insights';

export type Period = 'all' | '1d' | '7d' | '30d' | '90d';
export const PERIODS: { value: Period; label: string; days: number | null }[] = [
  { value: 'all', label: 'All recordings', days: null },
  { value: '1d', label: 'Latest day', days: 1 },
  { value: '7d', label: 'Last 7 days', days: 7 },
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '90d', label: 'Last 90 days', days: 90 },
];
export type ScopeSelection = { period: Period; queue: string };
export const DEFAULT_SCOPE: ScopeSelection = { period: 'all', queue: '' };

export function readPeriod(value: string | null): Period {
  return PERIODS.some((p) => p.value === value) ? (value as Period) : DEFAULT_SCOPE.period;
}
export function readSelection(params: URLSearchParams, fallback: ScopeSelection = DEFAULT_SCOPE): ScopeSelection {
  const queue = params.get('queue');
  return {
    period: params.has('period') ? readPeriod(params.get('period')) : fallback.period,
    queue: queue == null ? fallback.queue : queue === 'all' ? '' : queue.slice(0, 120),
  };
}
export function selectionParams(selection: ScopeSelection): Record<string, string> {
  return { period: selection.period, queue: selection.queue || 'all' };
}

const addDays = (value: string, days: number) => {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Periods are anchored on the latest recording in the data, not on today's date. */
export function scopeFor(selection: ScopeSelection, bounds: Bounds | undefined): Scope {
  const days = PERIODS.find((p) => p.value === selection.period)?.days ?? null;
  if (!days || !bounds?.maxDate) return { queue: selection.queue, start: '', end: '' };
  return { queue: selection.queue, start: addDays(bounds.maxDate, -(days - 1)), end: bounds.maxDate };
}

export function fmtDay(value: string, withYear = true) {
  if (!value) return '';
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}
export function rangeLabel(start: string, end: string) {
  if (!start || !end) return 'All recordings';
  if (start === end) return fmtDay(start);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${fmtDay(start, !sameYear)} – ${fmtDay(end)}`;
}
export function scopeLabel(selection: ScopeSelection, bounds: Bounds | undefined) {
  const scope = scopeFor(selection, bounds);
  const range = scope.start ? rangeLabel(scope.start, scope.end) : bounds ? rangeLabel(bounds.minDate, bounds.maxDate) : 'All recordings';
  return `${range} · ${selection.queue || 'All queues'}`;
}

export const DEFAULT_FILTERS: ExploreFilters = { q: '', reason: '', sentiment: '', theme: '', silence: false, page: 1 };
export function readFilters(params: URLSearchParams): ExploreFilters {
  const sentiment = params.get('sentiment') ?? '';
  const page = Number(params.get('page') ?? 1);
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    reason: (params.get('reason') ?? '').slice(0, 200),
    sentiment: ['negative', 'neutral', 'positive'].includes(sentiment) ? (sentiment as Sentiment) : '',
    theme: /^[A-Za-z0-9_-]{1,80}$/.test(params.get('theme') ?? '') ? (params.get('theme') as string) : '',
    silence: params.get('silence') === '1',
    page: Number.isSafeInteger(page) && page >= 1 && page <= 4000 ? page : 1,
  };
}
export function filterParams(filters: Partial<ExploreFilters>): Record<string, string> {
  const out: Record<string, string> = {};
  if (filters.q) out.q = filters.q;
  if (filters.reason) out.reason = filters.reason;
  if (filters.sentiment) out.sentiment = filters.sentiment;
  if (filters.theme) out.theme = filters.theme;
  if (filters.silence) out.silence = '1';
  if (filters.page && filters.page > 1) out.page = String(filters.page);
  return out;
}

/** Describe a change against the previous equal-length period without inventing a baseline. */
export function metricChange(current: number | null, previous: number | null, kind: 'percent' | 'points' | 'seconds') {
  if (current == null) return 'Not evaluated in this period';
  if (previous == null) return 'No evaluated prior-period comparison';
  if (kind === 'percent') {
    if (previous === 0) return 'No calls in the previous equal period';
    const change = Math.round(((current - previous) / previous) * 100);
    return `${change > 0 ? '+' : ''}${change}% vs previous equal period`;
  }
  if (kind === 'points') {
    const change = Math.round((current - previous) * 100);
    return `${change > 0 ? '+' : ''}${change} pts vs previous equal period`;
  }
  const change = Math.round(current - previous);
  return `${change > 0 ? '+' : ''}${change}s vs previous equal period`;
}
