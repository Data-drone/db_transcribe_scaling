import type { DateRange, Interaction } from '../types'

export function Trend({ calls, dateRange }: { calls: Interaction[]; dateRange: DateRange }) {
  const days = Array.from({ length: dateRange === '7d' ? 7 : 30 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9, 22 - (dateRange === '7d' ? 6 : 29) + index))
    const key = date.toISOString().slice(0, 10)
    return { key, day: date.getUTCDate(), count: calls.filter(call => call.startedAt.startsWith(key)).length }
  })
  const max = Math.max(...days.map(day => day.count), 1)
  return <div className="box volume-panel"><div className="row between"><div className="column"><h3>Conversation volume</h3><span className="small muted">Calls per day · {dateRange === '7d' ? '16–22 Oct' : '23 Sep–22 Oct'} 2026</span></div><span className="chart-total">{calls.length}<small>calls</small></span></div><div className="volume-chart"><div className="chart-axis"><span>{max}</span><span>{max / 2}</span><span>0</span></div><div className="chart-plot">{days.map(day => <div className="chart-day" key={day.key}><span className="chart-bar-area"><span className={`chart-bar${day.count === max ? ' peak' : ''}`} style={{ height: `${day.count / max * 100}%` }}><span className="chart-value">{day.count}</span></span></span><span className="chart-day-label">{days.length === 7 || day.day % 5 === 0 || day.key === days[0].key || day.key === days.at(-1)?.key ? day.day : ''}</span><span className="sr-only">{day.key}: {day.count} calls.</span></div>)}</div></div><div className="row between chart-footer"><span className="legend"><span className="sw"/>Daily demo calls</span><span className="small muted">Zero baseline · {dateRange === '7d' ? 'October' : 'September / October'}</span></div></div>
}
