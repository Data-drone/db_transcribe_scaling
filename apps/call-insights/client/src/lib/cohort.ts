import { sql } from '@databricks/appkit-ui/js';

export const queues = ['Cards and checks', 'Payments', 'Account access', 'General enquiries'];
export const PAGE_SIZE = 25;
export type Cohort = {
  queue: string;
  start: string;
  end: string;
  q: string;
  reason: string;
  sentiment: string;
  silence: string;
  enriched: string;
  page: number;
};

function validDate(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : '';
}

export function readCohort(params: URLSearchParams): Cohort {
  const page = Number(params.get('page') ?? 1);
  return {
    queue: queues.includes(params.get('queue') ?? '') ? params.get('queue')! : 'all',
    start: validDate(params.get('start')),
    end: validDate(params.get('end')),
    q: (params.get('q') ?? '').slice(0, 250),
    reason: params.get('reason') ?? 'all',
    sentiment: ['negative', 'neutral', 'positive'].includes(params.get('sentiment') ?? '')
      ? params.get('sentiment')!
      : 'all',
    silence: ['5', '10', '20'].includes(params.get('silence') ?? '') ? params.get('silence')! : '0',
    enriched: params.get('enriched') === 'true' ? 'true' : 'false',
    page: Number.isSafeInteger(page) && page > 0 && page < 1_000_000 ? page : 1,
  };
}

export function cohortSearch(patch: Partial<Cohort>, current?: Cohort): string {
  const next = { ...readCohort(new URLSearchParams()), ...current, ...patch };
  const params = new URLSearchParams();
  if (next.queue !== 'all') params.set('queue', next.queue);
  if (next.start) params.set('start', next.start);
  if (next.end) params.set('end', next.end);
  if (next.q) params.set('q', next.q);
  if (next.reason !== 'all') params.set('reason', next.reason);
  if (next.sentiment !== 'all') params.set('sentiment', next.sentiment);
  if (next.silence !== '0') params.set('silence', next.silence);
  if (next.enriched === 'true') params.set('enriched', 'true');
  if (next.page > 1) params.set('page', String(next.page));
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function scopeParameters(cohort: Cohort) {
  return {
    queue: sql.string(cohort.queue === 'all' ? '' : cohort.queue),
    start_date: sql.string(cohort.start),
    end_date: sql.string(cohort.end),
  };
}

export function cohortParameters(cohort: Cohort) {
  return {
    ...scopeParameters(cohort),
    min_silence: sql.number(Number(cohort.silence)),
    search_text: sql.string(cohort.q),
    contact_reason: sql.string(cohort.reason === 'all' ? '' : cohort.reason),
    sentiment: sql.string(cohort.sentiment === 'all' ? '' : cohort.sentiment),
    enriched_only: sql.string(cohort.enriched),
  };
}

export function scopeLabel(cohort: Cohort) {
  return `${cohort.queue === 'all' ? 'All queues' : cohort.queue} · ${cohort.start || 'first recording'} to ${cohort.end || 'latest recording'} (UTC)`;
}

export function labelDraftUrl(cohort: Cohort): string {
  const params = new URLSearchParams({ new: '1' });
  if (cohort.q) params.set('prefill_q', cohort.q);
  if (cohort.queue !== 'all') params.set('queue', cohort.queue);
  if (cohort.start) params.set('start', cohort.start);
  if (cohort.end) params.set('end', cohort.end);
  if (cohort.reason !== 'all') params.set('reason', cohort.reason);
  if (cohort.sentiment !== 'all') params.set('sentiment', cohort.sentiment);
  if (cohort.silence !== '0') params.set('silence', cohort.silence);
  if (cohort.enriched === 'true') params.set('enriched', cohort.enriched);
  return `/labels?${params.toString()}`;
}

export function metricChange(
  current: number | null | undefined,
  previous: number | null | undefined,
  unit: 'percent' | 'seconds' | 'points'
): string {
  if (current == null || previous == null || !Number.isFinite(Number(current)) || !Number.isFinite(Number(previous)))
    return 'No evaluated prior-period comparison';
  if (unit === 'percent' && Number(previous) === 0) return 'No calls in the previous equal period';
  const delta =
    unit === 'percent'
      ? (Number(current) / Number(previous) - 1) * 100
      : unit === 'points'
        ? (Number(current) - Number(previous)) * 100
        : Number(current) - Number(previous);
  const rounded = Number(delta.toFixed(1));
  return `${rounded > 0 ? '+' : ''}${rounded}${unit === 'percent' ? '%' : unit === 'seconds' ? 's' : ' pts'} vs previous equal period`;
}
