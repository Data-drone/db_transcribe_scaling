import { Filters } from '../components/Filters'
import { Icon } from '../components/Icon'
import { Trend } from '../components/Trend'
import { Empty, Kpi, LinkBtn } from '../components/ui'
import { exploreRoute, filterInteractions } from '../cohort'
import { THEMES } from '../data'
import { fmtDuration } from '../format'
import { useStore } from '../store'

export function Overview() {
  const { queue, dateRange, cases } = useStore()
  const calls = filterInteractions({ queue, dateRange })
  const scope = { queue, dateRange }
  const themes = THEMES.map(theme => ({ ...theme, calls: calls.filter(call => call.themes.includes(theme.id)) })).filter(theme => theme.calls.length).sort((a, b) => b.calls.length - a.calls.length)
  const featured = themes[0]
  const reasons = [...new Set(calls.map(call => call.contactReason))].map(name => ({ name, count: calls.filter(call => call.contactReason === name).length })).sort((a, b) => b.count - a.count)
  const negative = calls.filter(call => call.sentimentEnd === 'negative').length
  const repeats = calls.filter(call => call.repeatContact).length
  const unresolved = featured?.calls.filter(call => call.resolution !== 'resolved').length ?? 0
  return (
    <section className="screen overview-screen">
      <div className="row between page-heading"><div className="column"><span className="eyebrow">LISTEN. UNDERSTAND. IMPROVE.</span><h2>Conversation overview<span className="title-dot">.</span></h2><p className="muted">Find the friction. Follow the evidence.</p></div><Filters /></div>
      <div className="kpis">
        <Kpi label="Calls in scope" value={String(calls.length).padStart(2, '0')} delta={`${dateRange === '7d' ? '7' : '30'} days · synthetic demo sample`} />
        <Kpi label="Average call duration" value={calls.length ? fmtDuration(Math.round(calls.reduce((sum, call) => sum + call.durationSeconds, 0) / calls.length)) : '—'} delta="Recording duration · excludes wrap-up" />
        <Kpi label="Negative closing sentiment" value={calls.length ? `${Math.round(negative / calls.length * 100)}%` : '—'} delta={`${negative} of ${calls.length} calls · AI fixture, unverified`} tone={negative ? 'bad' : 'neutral'} />
        <Kpi label="Repeat contact mentioned" value={String(repeats).padStart(2, '0')} delta="Mention flag · not a measured repeat rate" />
      </div>
      {calls.length === 0 ? <Empty>No demo calls in this scope. Choose another queue or expand to 30 days.</Empty> : <>
        <div className="overview-grid">
          <div className="box featured-investigation">
            <div className="row between"><span className="eyebrow"><span className="status-dot"/> INVESTIGATION SPOTLIGHT</span><span className="tag red-tag">AI-SUGGESTED PATTERN</span></div>
            <div className="featured-body"><div className="featured-copy"><span className="small muted">A place to start</span><h3>{featured?.name ?? 'Review your conversations'}</h3><p>{featured?.id === 'dup-charge' ? 'Customers describe duplicate bill payments. Inspect the conversations before drawing a conclusion.' : featured?.id === 'pwd-reset' ? 'Verification steps appear in password-reset calls. Review the moments behind the pattern.' : 'Follow a suggested pattern back to the words in each conversation.'}</p></div><div className="spotlight-count"><strong>{String(featured?.calls.length ?? calls.length).padStart(2, '0')}</strong><span>matching demo calls</span></div></div>
            <div className="featured-bottom"><span className="small muted">{featured ? `${unresolved} not resolved in this call · ${featured.calls.length} available to review` : `${calls.length} available to review`}</span><LinkBtn className="btn primary" to={exploreRoute({ ...scope, theme: featured?.id ?? 'all' })}>Investigate calls <Icon name="arrow" size={16}/></LinkBtn></div>
          </div>
          <div className="box workflow-card"><span className="eyebrow">YOUR NEXT FINDING</span><h3>Build a case.<br/>Back it with evidence.</h3><ol className="workflow-steps"><li><span>01</span>Find a relevant conversation</li><li><span>02</span>Review a timestamped moment</li><li><span>03</span>Save the excerpt and your note</li></ol><LinkBtn className="workflow-link" to={{ name: 'cases' }}>{cases.length} saved {cases.length === 1 ? 'investigation' : 'investigations'} <Icon name="arrow" size={16}/></LinkBtn></div>
        </div>
        <div className="overview-grid charts-grid"><Trend calls={calls} dateRange={dateRange}/><div className="box reason-panel"><div className="row between"><div className="column"><h3>Why customers called</h3><span className="small muted">Contact reasons · selected demo calls</span></div><Icon name="explore" size={17}/></div><div className="reason-bars">{reasons.map(reason => <LinkBtn key={reason.name} className="reason-row" to={exploreRoute({ ...scope, reason: reason.name })}><span className="row between"><span>{reason.name}</span><b>{reason.count} <Icon name="chevron" size={12}/></b></span><span className="reason-track"><i style={{ width: `${reason.count / calls.length * 100}%` }}/></span></LinkBtn>)}</div><span className="small muted">Select a reason to explore the same cohort.</span></div></div>
        <div className="box patterns-panel"><div className="row between"><div className="column"><h3>Patterns to investigate</h3><span className="small muted">Illustrative AI labels · verify against the transcript</span></div><LinkBtn className="subtle-link" to={exploreRoute(scope)}>Explore all calls <Icon name="arrow" size={15}/></LinkBtn></div><div className="pattern-list">{themes.map((theme, index) => <LinkBtn key={theme.id} className="pattern-row" to={exploreRoute({ ...scope, theme: theme.id })}><span className="pattern-number">0{index + 1}</span><span className="pattern-title">{theme.name}<small>{[...new Set(theme.calls.map(call => call.queue))].join(' · ')}</small></span><span className="pattern-meter"><i style={{ width: `${theme.calls.length / calls.length * 100}%` }}/></span><b>{theme.calls.length} calls</b><Icon name="arrow" size={17}/></LinkBtn>)}</div>{!themes.length && <p className="muted">No suggested patterns in this scope. Explore calls to start a finding.</p>}</div>
      </>}
      <p className="data-footnote"><Icon name="shield" size={13}/> All metrics use the selected synthetic calls. No previous-period comparison is available. Generated labels and sentiment are fixtures.</p>
    </section>
  )
}
