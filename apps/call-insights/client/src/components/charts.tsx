import { BarChart, LineChart } from '@databricks/appkit-ui/react';
import type { OverviewData, TrackingPoint } from '../../../shared/insights';
import { alignPeriods } from '../lib/periods';
import { fmtDay } from '../lib/scope';

/**
 * Chart roles. The app is single-accent: the current period is the brand red and the
 * previous period is a recessive grey reference layer (always labelled in legend and tooltip).
 */
export const CHART = { current: '#e5444e', previous: '#5f6069', muted: '#3a3b42' };

export function VolumeChart({
  current,
  previous,
  focusDay,
  onDay,
}: {
  current: OverviewData;
  previous: OverviewData | undefined;
  focusDay?: string;
  onDay: (date: string) => void;
}) {
  const aligned = alignPeriods(current, previous);
  // Pass only the label and counts: a date-like field would switch the chart to a time axis.
  const rows = aligned.map(({ date: _date, ...row }) => row);
  const compare = Boolean(previous && current.previousCalls > 0);
  const selected = aligned.find((r) => r.date === focusDay)?.Day;
  return (
    <BarChart
      data={rows}
      xKey="Day"
      orientation="vertical"
      yKey={compare ? ['Calls', 'Calls before'] : ['Calls']}
      colors={compare ? [CHART.current, CHART.previous] : [CHART.current]}
      showLegend={compare}
      height={230}
      selected={selected}
      ariaLabel={`Calls per recording day${compare ? ', compared with the same day in the previous equal period' : ''}. Click a day to open its calls.`}
      onDataClick={(datum) => {
        const row = aligned.find((r) => r.Day === datum.name);
        if (row) onDay(row.date);
      }}
      options={{ grid: { left: 36, right: 12, top: compare ? 36 : 16, bottom: 28 }, barGap: '12%', barCategoryGap: '34%' }}
    />
  );
}

export function ReasonChart({
  reasons,
  selected,
  onSelect,
}: {
  reasons: OverviewData['reasons'];
  selected: string;
  onSelect: (reason: string) => void;
}) {
  const rows = [...reasons].slice(0, 9).reverse().map((r) => ({ reason: r.name, Calls: r.calls }));
  return (
    <BarChart
      data={rows}
      xKey="reason"
      yKey="Calls"
      orientation="horizontal"
      colors={[CHART.current]}
      showLegend={false}
      height={Math.max(160, rows.length * 34 + 30)}
      selected={selected || undefined}
      ariaLabel="Calls by AI contact reason. Click a reason to focus the overview on it."
      onDataClick={(datum) => onSelect(datum.name === selected ? '' : datum.name)}
      options={{ grid: { left: 150, right: 24, top: 6, bottom: 22 } }}
    />
  );
}

/** Share of evaluated calls matching a tracked label, per recording day. */
export function TrackingChart({ points }: { points: TrackingPoint[] }) {
  const rows = points.map((p) => ({ Day: fmtDay(p.date, false), Matching: p.evaluated ? Math.round((p.matched / p.evaluated) * 1000) / 10 : 0 }));
  return (
    <LineChart
      data={rows}
      xKey="Day"
      yKey="Matching"
      colors={[CHART.current]}
      showLegend={false}
      showSymbol
      smooth={false}
      height={180}
      ariaLabel="Share of evaluated calls matching this label per recording day"
      valueFormatter={(value) => `${value}% of evaluated calls`}
      options={{ grid: { left: 40, right: 12, top: 12, bottom: 26 }, yAxis: { min: 0, axisLabel: { formatter: '{value}%' } } }}
    />
  );
}
