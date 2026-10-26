import { describe, expect, it } from 'vitest';
import { cohortSearch, labelDraftUrl, metricChange, readCohort } from '../client/src/lib/cohort';

describe('investigation cohort navigation', () => {
  it('retains the selected population and search when paging or returning from a call', () => {
    const cohort = readCohort(
      new URLSearchParams(
        'queue=Payments&start=2026-10-01&end=2026-10-20&q=charged%20twice&sentiment=negative&reason=pay%20bill&silence=10&enriched=true&page=2'
      )
    );
    const next = cohortSearch({ page: 3 }, cohort);
    const callParams = new URLSearchParams({ from: `/explore${next}`, t: '34', q: cohort.q });
    const restored = new URLSearchParams(callParams.toString()).get('from')!;
    expect(restored).toBe(`/explore${next}`);
    expect(readCohort(new URLSearchParams(restored.split('?')[1]))).toEqual({ ...cohort, page: 3 });
  });

  it('does not send invalid calendar dates or unbounded page offsets to the warehouse', () => {
    const cohort = readCohort(
      new URLSearchParams('start=2026-02-30&end=invalid&page=9999999999&queue=unknown&silence=-1&sentiment=missing')
    );
    expect(cohort.start).toBe('');
    expect(cohort.end).toBe('');
    expect(cohort.page).toBe(1);
    expect(cohort.queue).toBe('all');
    expect(cohort.silence).toBe('0');
    expect(cohort.sentiment).toBe('all');
  });

  it('includes unevaluated calls by default and preserves literal search characters', () => {
    const defaults = readCohort(new URLSearchParams());
    expect(defaults.enriched).toBe('false');
    const q = 'refund 10% _ + & # ?';
    expect(readCohort(new URLSearchParams(cohortSearch({ q }).slice(1))).q).toBe(q);
  });

  it('starts a label draft with the literal phrase and selected recording scope', () => {
    const cohort = readCohort(
      new URLSearchParams(
        'q=refund%20%26%20return&queue=Payments&start=2026-10-01&end=2026-10-20&reason=pay%20bill&sentiment=negative&silence=10&enriched=true&page=3'
      )
    );
    const draft = new URL(labelDraftUrl(cohort), 'https://app.example');
    expect(draft.pathname).toBe('/labels');
    expect(Object.fromEntries(draft.searchParams)).toEqual({
      new: '1',
      prefill_q: 'refund & return',
      queue: 'Payments',
      start: '2026-10-01',
      end: '2026-10-20',
      reason: 'pay bill',
      sentiment: 'negative',
      silence: '10',
      enriched: 'true',
    });
  });

  it('distinguishes absent baselines from measured zero shares', () => {
    expect(metricChange(15, 10, 'percent')).toBe('+50% vs previous equal period');
    expect(metricChange(15, 0, 'percent')).toBe('No calls in the previous equal period');
    expect(metricChange(0.1, null, 'points')).toBe('No evaluated prior-period comparison');
    expect(metricChange(0.1, 0, 'points')).toBe('+10 pts vs previous equal period');
    expect(metricChange(58, 62, 'seconds')).toBe('-4s vs previous equal period');
  });
});
