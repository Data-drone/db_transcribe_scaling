import { useState } from 'react'
import { Filters } from '../components/Filters'
import { Empty, Kpi, LinkBtn } from '../components/ui'
import { exploreRoute, filterInteractions } from '../cohort'
import { QUEUES, themeById } from '../data'
import { fmtDate, fmtDuration } from '../format'
import { go } from '../router'
import { useStore } from '../store'
import { maskedText } from '../privacy'

export function ThemeDetail({ id }: { id: string }) {
  const theme = themeById(id)
  const { cases, addCaseItem, upsertLabel, queue, dateRange } = useStore()
  const [savedScope, setSavedScope] = useState('')
  if (!theme) return <section className="screen"><Empty>Unknown theme. <LinkBtn to={{ name: 'overview' }}>Return to Overview</LinkBtn></Empty></section>

  const population = filterInteractions({ queue, dateRange })
  const calls = filterInteractions({ queue, dateRange, theme: id })
  const average = calls.length ? calls.reduce((sum, call) => sum + call.durationSeconds, 0) / calls.length : 0
  const repeatMentions = calls.filter((call) => call.repeatContact).length
  const negative = calls.filter((call) => call.sentimentEnd === 'negative').length
  const byQueue = QUEUES.map((name) => ({
    name,
    calls: calls.filter((call) => call.queue === name),
  })).filter((group) => group.calls.length)
  const scope = `${dateRange === '7d' ? '16–22 Oct 2026' : '23 Sep–22 Oct 2026'} · ${queue === 'all' ? 'All queues' : queue}`
  const scopeKey = `${id}:${dateRange}:${queue}`
  const saved = savedScope === scopeKey

  return (
    <section className="screen">
      <div className="crumb"><LinkBtn to={{ name: 'overview' }}>Overview</LinkBtn> / Pattern</div>
      <div className="row between page-heading">
        <div className="column">
          <span className="eyebrow">Investigate a pattern</span>
          <h2>{theme.name}</h2>
          <p className="muted">Inspect the conversations behind this demo pattern.</p>
        </div>
        <Filters />
      </div>

      <div className="scope-strip">
        <span><strong>{calls.length} matching demo calls</strong> of {population.length} in selected scope</span>
        <span>{scope} · Synthetic enrichment · As of 22 Oct 2026</span>
      </div>

      <div className="row between">
        <LinkBtn to={exploreRoute({ queue, dateRange, theme: id })} className="btn primary">Explore matching calls →</LinkBtn>
        <button className="btn" onClick={() => {
          upsertLabel({
            id: `from-${theme.id}`, name: theme.name, owner: 'you', status: 'draft', tracked: false,
            version: 1, definition: theme.summary, includeExamples: '', excludeExamples: '',
            speakerFocus: 'any', matchShare: 0, matchedCount: 0, scopeCount: calls.length,
            agreement: { correct: 0, reviewed: 0 }, lastRun: 'not run',
            byQueue: QUEUES.map((name) => ({ queue: name, share: 0 })), sample: [],
          })
          go({ name: 'label', id: `from-${theme.id}` })
        }}>Refine as a label</button>
      </div>

      <div className="kpis">
        <Kpi label="Matching conversations" value={String(calls.length)} delta={`${population.length ? Math.round(calls.length / population.length * 100) : 0}% of selected demo calls`} />
        <Kpi label="Average call duration" value={calls.length ? fmtDuration(Math.round(average)) : '—'} delta="Recording duration · selected demo matches" />
        <Kpi label="Repeat contact mentioned" value={calls.length ? `${repeatMentions} / ${calls.length}` : '—'} delta="Synthetic mention flag · not a measured repeat rate" />
        <Kpi label="Negative end sentiment" value={calls.length ? `${negative} / ${calls.length}` : '—'} delta="AI fixture · verify each conversation" />
      </div>

      <div className="cols cols-even">
        <div className="box">
          <span className="tag">Illustrative AI pattern</span>
          <h3>Working hypothesis</h3>
          <p>{theme.summary}</p>
          <p className="small muted">This description is a hand-authored demo fixture. Matching calls use seeded theme tags; no model or warehouse query runs here. The sample does not establish a trend, a cause or business impact.</p>
        </div>
        <div className="box">
          <h3>Matching calls by queue</h3>
          {byQueue.length ? <dl>{byQueue.map((group) => (
            <QueueRow key={group.name} queue={group.name} count={group.calls.length} duration={Math.round(group.calls.reduce((sum, call) => sum + call.durationSeconds, 0) / group.calls.length)} />
          ))}</dl> : <Empty>No matches in this scope. Choose another queue or period.</Empty>}
          <p className="small muted">Counts and durations use the same filtered demo calls shown below.</p>
        </div>
      </div>

      <div className="box">
        <div className="row between"><h3>Conversations to review</h3><span className="small muted">All {calls.length} matches · newest first</span></div>
        {!calls.length ? <Empty>No calls match this pattern in the selected scope. <LinkBtn to={exploreRoute({ queue, dateRange })}>Explore this scope</LinkBtn></Empty> : <ul className="list">
          {calls.map((call) => {
            const excerpt = call.segments.find((segment) => segment.role === 'customer' && segment.text.length > 40) ?? call.segments[0]
            return <li key={call.id}>
              <div className="row between">
                <LinkBtn to={{ name: 'call', id: call.id, from: `#/themes/${theme.id}?period=${dateRange}&queue=${encodeURIComponent(queue)}`, t: excerpt?.start }}>
                  {call.id} · {fmtDate(call.startedAt)} · {fmtDuration(call.durationSeconds)}
                </LinkBtn>
                <span className="tag">AI end sentiment: {call.sentimentEnd}</span>
              </div>
              <p className="small muted">{call.queue} · “{maskedText(excerpt?.text ?? call.summary)}”</p>
            </li>
          })}
        </ul>}
      </div>

      {cases[0] && <div className="box">
        <div className="row between">
          <div className="column"><h3>Collect this finding</h3><p className="small muted">Save the pattern and selected scope to “{cases[0].title}”. Stored in this browser.</p></div>
          <button className="btn" disabled={saved || !calls.length} onClick={() => {
            addCaseItem(cases[0].id, { type: 'theme', refId: theme.id, note: `${calls.length} matching demo calls of ${population.length} in scope. ${scope}. Demo pattern; no causal or corpus-wide inference.` })
            setSavedScope(scopeKey)
          }}>{saved ? 'Saved to case' : 'Save pattern to case'}</button>
        </div>
        {saved && <p className="small" role="status">Pattern saved. <LinkBtn to={{ name: 'case', id: cases[0].id }}>Open case →</LinkBtn></p>}
      </div>}
    </section>
  )
}

function QueueRow({ queue, count, duration }: { queue: string; count: number; duration: number }) {
  return <><dt>{queue}</dt><dd>{count} calls · {fmtDuration(duration)} avg duration</dd></>
}
