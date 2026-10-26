import type { OverviewData } from '../../../shared/insights';
import { fmtDay, rangeLabel } from '../lib/scope';

/** Daily volume for days that have recordings. Days without recordings are not drawn as zero. */
export function Trend({ overview }: { overview: OverviewData }) {
  const days = overview.daily;
  const max = Math.max(...days.map((d) => d.calls), 1);
  const labelEvery = Math.max(1, Math.ceil(days.length / 10));
  return (
    <div className="box volume-panel">
      <div className="row between">
        <div className="column">
          <h3>Conversation volume</h3>
          <span className="small muted">Calls per recording day · {rangeLabel(overview.periodStart, overview.periodEnd)}</span>
        </div>
        <span className="chart-total">
          {overview.calls.toLocaleString()}
          <small>calls</small>
        </span>
      </div>
      {days.length ? (
        <div className="volume-chart">
          <div className="chart-axis">
            <span>{max}</span>
            <span>{Math.round(max / 2)}</span>
            <span>0</span>
          </div>
          <div className="chart-plot">
            {days.map((d, i) => (
              <div className="chart-day" key={d.date}>
                <span className="chart-bar-area">
                  <span className={`chart-bar${d.calls === max ? ' peak' : ''}`} style={{ height: `${(d.calls / max) * 100}%` }}>
                    <span className="chart-value">{d.calls}</span>
                  </span>
                </span>
                <span className="chart-day-label">{i % labelEvery === 0 || i === days.length - 1 ? fmtDay(d.date, false) : ''}</span>
                <span className="sr-only">
                  {d.date}: {d.calls} calls.
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="muted small">No recordings in this period.</p>
      )}
      <div className="row between chart-footer">
        <span className="legend">
          <span className="sw" />
          Calls per day
        </span>
        <span className="small muted">Zero baseline · only days with recordings are shown</span>
      </div>
    </div>
  );
}
