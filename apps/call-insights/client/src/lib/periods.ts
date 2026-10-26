import type { OverviewData } from '../../../shared/insights';
import { fmtDay } from './scope';

const addDays = (value: string, days: number) => {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Pair each recording day with the same offset day in the previous equal-length period. */
export function alignPeriods(current: OverviewData, previous: OverviewData | undefined) {
  const length = current.periodStart && current.periodEnd ? daysBetween(current.periodStart, current.periodEnd) + 1 : 0;
  const prior = new Map((previous?.daily ?? []).map((d) => [d.date, d.calls]));
  return current.daily.map((d) => ({
    date: d.date,
    Day: fmtDay(d.date, false),
    Calls: d.calls,
    'Calls before': length ? (prior.get(addDays(d.date, -length)) ?? 0) : 0,
  }));
}
