import { useEffect } from 'react'
import { Empty, LinkBtn } from '../components/ui'
import { DEFAULT_EXPLORE_FILTERS, exploreFiltersFromHash, exploreHash, filterInteractions } from '../cohort'
import { INTERACTIONS, QUEUES, THEMES } from '../data'
import { fmtDate, fmtDuration, fmtTime } from '../format'
import { maskedText } from '../privacy'
import { go } from '../router'
import { useStore } from '../store'
import type { ExploreFilters, Interaction } from '../types'

const PAGE_SIZE = 5
const REASONS = [...new Set(INTERACTIONS.map((call) => call.contactReason))]

export function Explore() {
  const { queue, dateRange, setQueue, setDateRange, upsertLabel } = useStore()
  const filters = exploreFiltersFromHash(window.location.hash, { queue, dateRange })
  const rows = filterInteractions(filters)
  const scoped = filterInteractions({ queue: filters.queue, dateRange: filters.dateRange })
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(filters.page, pages)
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const returnHash = exploreHash({ ...filters, page })
  const activeTheme = THEMES.find((theme) => theme.id === filters.theme)
  const hasFilters = Boolean(filters.keyword || filters.reason !== 'all' || filters.theme !== 'all' || filters.sentiment !== 'all' || filters.silence)

  useEffect(() => {
    if (queue !== filters.queue) setQueue(filters.queue)
    if (dateRange !== filters.dateRange) setDateRange(filters.dateRange)
  }, [queue, dateRange, filters.queue, filters.dateRange, setQueue, setDateRange])

  function update(patch: Partial<ExploreFilters>, resetPage = true) {
    const next = { ...filters, ...patch, page: resetPage ? 1 : patch.page ?? page }
    if (patch.queue != null) setQueue(patch.queue)
    if (patch.dateRange != null) setDateRange(patch.dateRange)
    // Search refinement replaces the current URL, so Back returns to the entry point.
    window.history.replaceState(null, '', exploreHash(next))
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }

  function saveLabel(id: string) {
    const name = filters.keyword || activeTheme?.name || (filters.reason !== 'all' ? filters.reason : 'Saved investigation')
    upsertLabel({
      id,
      name,
      owner: 'you',
      status: 'draft',
      tracked: false,
      version: 1,
      definition: filters.keyword ? `Transcript or summary contains “${filters.keyword}”.` : `Investigate: ${name}. Refine this definition before testing.`,
      includeExamples: '',
      excludeExamples: '',
      speakerFocus: 'any',
      matchShare: 0,
      matchedCount: 0,
      scopeCount: rows.length,
      agreement: { correct: 0, reviewed: 0 },
      lastRun: 'not run',
      byQueue: QUEUES.map((item) => ({ queue: item, share: 0 })),
      sample: [],
    })
    go({ name: 'label', id })
  }

  return (
    <section className="screen explore-screen">
      <div className="row between page-heading">
        <div className="column">
          <span className="eyebrow">INVESTIGATE</span>
          <h2>Explore conversations</h2>
          <p className="muted">Find the pattern. Open the evidence. Build your case.</p>
        </div>
        <button className="btn" onClick={() => saveLabel(`label-${crypto.randomUUID()}`)}>Save as label ↗</button>
      </div>

      <div className="box filter-panel">
        <div className="explore-toolbar">
          <label className="search-field">
            Search transcript and summary
            <input className="input" type="search" value={filters.keyword} onChange={(event) => update({ keyword: event.target.value })} placeholder="Search words or an exact phrase…" />
          </label>
          <label>
            Period ending 22 Oct 2026
            <select className="select" value={filters.dateRange} onChange={(event) => update({ dateRange: event.target.value as ExploreFilters['dateRange'] })}>
              <option value="7d">16–22 Oct · 7 days</option>
              <option value="30d">23 Sep–22 Oct · 30 days</option>
            </select>
          </label>
          <label>
            Queue
            <select className="select" value={filters.queue} onChange={(event) => update({ queue: event.target.value as ExploreFilters['queue'] })}>
              <option value="all">All queues</option>
              {QUEUES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <div className="row filter-secondary">
          <label>
            Contact reason
            <select className="select" value={filters.reason} onChange={(event) => update({ reason: event.target.value })}>
              <option value="all">All reasons</option>
              {REASONS.map((reason) => <option key={reason}>{reason}</option>)}
            </select>
          </label>
          <label>
            End sentiment · AI generated
            <select className="select" value={filters.sentiment} onChange={(event) => update({ sentiment: event.target.value as ExploreFilters['sentiment'] })}>
              <option value="all">Any sentiment</option>
              <option value="negative">Negative</option>
              <option value="neutral">Neutral</option>
              <option value="positive">Positive</option>
            </select>
          </label>
          <label>
            Theme · AI generated
            <select className="select" value={filters.theme} onChange={(event) => update({ theme: event.target.value })}>
              <option value="all">All themes</option>
              {THEMES.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
            </select>
          </label>
          <label className="checkbox-filter">
            <input type="checkbox" checked={filters.silence} onChange={(event) => update({ silence: event.target.checked })} />
            Silence ≥ 10 seconds
          </label>
          {hasFilters ? <button className="link clear-filters" onClick={() => update({ ...DEFAULT_EXPLORE_FILTERS, queue: filters.queue, dateRange: filters.dateRange })}>Clear filters</button> : null}
        </div>
        {hasFilters ? (
          <div className="active-filters" aria-label="Active search filters">
            {filters.keyword ? <button className="tag" onClick={() => update({ keyword: '' })}>Contains “{filters.keyword}” ×</button> : null}
            {filters.reason !== 'all' ? <button className="tag" onClick={() => update({ reason: 'all' })}>{filters.reason} ×</button> : null}
            {activeTheme ? <button className="tag" onClick={() => update({ theme: 'all' })}>{activeTheme.name} ×</button> : null}
            {filters.sentiment !== 'all' ? <button className="tag" onClick={() => update({ sentiment: 'all' })}>{filters.sentiment} sentiment ×</button> : null}
            {filters.silence ? <button className="tag" onClick={() => update({ silence: false })}>Silence ≥ 10s ×</button> : null}
          </div>
        ) : null}
      </div>

      <div className="results-heading row between">
        <div className="row">
          <h3>{rows.length} matching {rows.length === 1 ? 'conversation' : 'conversations'}</h3>
          <span className="tag">{scoped.length} in selected scope</span>
        </div>
        <span className="small muted">Newest first · exact phrase search</span>
      </div>
      <p className="small muted results-disclosure">Illustrative local sample. All {scoped.length} scoped calls have synthetic enrichment. Counts describe these fixtures only; AI summaries and sentiment need review.</p>

      {rows.length === 0 ? (
        <Empty>
          <p>No conversations match this search.</p>
          <p className="small">Try a shorter phrase, clear a filter, or choose another queue.</p>
          <button className="btn" onClick={() => update({ ...DEFAULT_EXPLORE_FILTERS, queue: 'all', dateRange: filters.dateRange })}>Reset search</button>
        </Empty>
      ) : (
        <div className="box results-box">
          <div className="table-scroll">
            <table className="data results-table">
              <thead>
                <tr>
                  <th>Conversation & matching evidence</th>
                  <th>Queue / reason</th>
                  <th>Agent</th>
                  <th>Duration</th>
                  <th>End sentiment</th>
                  <th><span className="sr-only">Review</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((call) => {
                  const match = evidence(call, filters.keyword, filters.theme)
                  const route = { name: 'call' as const, id: call.id, from: returnHash, t: match.time }
                  return (
                    <tr key={call.id}>
                      <td>
                        <div className="row call-result-title">
                          <LinkBtn to={route} className="call-id">{call.id}</LinkBtn>
                          <span className="small muted">{fmtDate(call.startedAt)}</span>
                        </div>
                        <div className="match-excerpt">
                          <span className="small muted">{match.source} </span>
                          {highlight(match.text, filters.keyword)}
                        </div>
                        {match.source !== 'AI summary' ? <LinkBtn to={route} className="evidence-time">↗ {fmtTime(match.time)} · Open this moment</LinkBtn> : <span className="small muted">Summary match · verify in transcript</span>}
                      </td>
                      <td><strong>{call.queue}</strong><span className="small muted cell-secondary">{call.contactReason}</span></td>
                      <td>{call.agentName}</td>
                      <td className="mono">{fmtDuration(call.durationSeconds)}</td>
                      <td><span className={`tag sentiment-${call.sentimentEnd}`}><span className="status-dot" />{call.sentimentEnd}</span></td>
                      <td><LinkBtn to={route} className="result-arrow"><span aria-hidden="true">↗</span><span className="sr-only">Review {call.id}</span></LinkBtn></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="pagination row between">
            <span className="small muted" aria-live="polite">Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, rows.length)} of {rows.length} matching conversations</span>
            <div className="row">
              <button className="btn" disabled={page <= 1} onClick={() => update({ page: page - 1 }, false)}>← Previous</button>
              <span className="small">{page} / {pages}</span>
              <button className="btn" disabled={page >= pages} onClick={() => update({ page: page + 1 }, false)}>Next →</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

const THEME_PHRASES: Record<string, RegExp> = {
  'dup-charge': /duplicate|charged twice|posted twice|two (?:charges|payments)|second charge/i,
  'reverify-xfer': /(?:account number|identity|verified).*(?:again|already)|(?:again|already).*(?:account number|identity|verified)|gave all of this|last person/i,
  'pwd-reset': /password|reset|cannot get into online banking/i,
}

function evidence(call: Interaction, keyword: string, theme: string) {
  const query = keyword.trim().toLowerCase()
  const match = query ? call.segments.find((segment) => maskedText(segment.text).toLowerCase().includes(query)) : null
  if (match) return { text: maskedText(match.text), time: match.start, source: 'Transcript' }
  if (query) return { text: maskedText(call.summary), time: call.segments[0]?.start ?? 0, source: 'AI summary' }
  const phrase = THEME_PHRASES[theme]
  // Literal phrase matching makes the suggested moment inspectable in this mock.
  const ordered = [...call.segments.filter((segment) => segment.role === 'customer'), ...call.segments.filter((segment) => segment.role === 'agent')]
  const related = phrase ? ordered.find((segment) => phrase.test(maskedText(segment.text))) : null
  if (related) return { text: maskedText(related.text), time: related.start, source: 'Related transcript' }
  const preview = ordered.find((segment) => !maskedText(segment.text).includes('[account number hidden]')) ?? call.segments[0]
  return { text: maskedText(preview?.text ?? call.summary), time: preview?.start ?? 0, source: 'Transcript' }
}

function highlight(text: string, keyword: string) {
  const query = keyword.trim()
  if (!query) return text
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return text
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>
}
