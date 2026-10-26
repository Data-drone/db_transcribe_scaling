import { QUEUES } from '../data'
import { useStore } from '../store'

export function Filters() {
  const { dateRange, queue, setDateRange, setQueue } = useStore()
  function updateScope(patch: { queue?: typeof queue; dateRange?: typeof dateRange }) {
    const next = { queue, dateRange, ...patch }
    setQueue(next.queue)
    setDateRange(next.dateRange)
    const [path, query] = window.location.hash.split('?')
    const params = new URLSearchParams(query ?? '')
    params.set('period', next.dateRange)
    params.set('queue', next.queue)
    window.history.replaceState(null, '', `${path}?${params}`)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
  return (
    <div className="row filters">
      <label>
        Period ending 22 Oct 2026
        <select className="select" value={dateRange} onChange={(e) => updateScope({ dateRange: e.target.value as typeof dateRange })}>
          <option value="7d">16–22 Oct · 7 days</option>
          <option value="30d">23 Sep–22 Oct · 30 days</option>
        </select>
      </label>
      <label>
        Queue
        <select className="select" value={queue} onChange={(e) => updateScope({ queue: e.target.value as typeof queue })}>
          <option value="all">All queues</option>
          {QUEUES.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
