import { useState } from 'react'
import { Bars, Empty, Kpi, LinkBtn } from '../components/ui'
import { INTERACTIONS, QUEUES } from '../data'
import { fmtTime, pct } from '../format'
import { go } from '../router'
import { useStore } from '../store'
import type { LabelDef } from '../types'

export function Labels() {
  const { labels, upsertLabel } = useStore()
  const [q, setQ] = useState('')
  const shown = labels.filter((l) => l.name.toLowerCase().includes(q.toLowerCase()) || l.definition.toLowerCase().includes(q.toLowerCase()))

  return (
    <section className="screen">
      <div className="row between">
        <div className="column">
          <h2>Labels</h2>
          <span className="small muted">Plain-English patterns · Local simulation. Sample tests and runs use predefined fixtures, with no LLM or warehouse query.</span>
        </div>
        <div className="row">
          <input className="input" style={{ width: 200 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search labels" />
          <button
            className="btn primary"
            onClick={() => {
              const id = `label-${Date.now()}`
              upsertLabel({
                id,
                name: 'New label',
                owner: 'you',
                status: 'draft',
                tracked: false,
                version: 1,
                definition: '',
                includeExamples: '',
                excludeExamples: '',
                speakerFocus: 'any',
                matchShare: 0,
                matchedCount: 0,
                scopeCount: INTERACTIONS.length,
                agreement: { correct: 0, reviewed: 0 },
                lastRun: 'not run',
                byQueue: QUEUES.map((queue) => ({ queue, share: 0 })),
                sample: [],
              })
              go({ name: 'label', id })
            }}
          >
            New label
          </button>
        </div>
      </div>
      {shown.length === 0 ? (
        <Empty>No labels match.</Empty>
      ) : (
        <div className="box">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Last run</th>
                <th>Agreement</th>
                <th>Tracked</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id}>
                  <td><LinkBtn to={{ name: 'label', id: l.id }}>{l.name}</LinkBtn></td>
                  <td>{l.owner}</td>
                  <td>{l.status}</td>
                  <td>{l.lastRun}</td>
                  <td>{l.agreement.reviewed ? `${l.agreement.correct} of ${l.agreement.reviewed}` : '—'}</td>
                  <td>{l.tracked ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function LabelBuilder({ id }: { id: string }) {
  const { labels, upsertLabel, setVerdict } = useStore()
  const label = labels.find((l) => l.id === id)
  const [busy, setBusy] = useState<'sample' | 'full' | null>(null)
  const [estimate, setEstimate] = useState(false)
  if (!label) return <section className="screen"><Empty>Unknown label.</Empty></section>
  const current: LabelDef = label

  function patch(p: Partial<LabelDef>) {
    const next: LabelDef = { ...current, ...p }
    if (p.definition && p.definition !== current.definition) {
      next.version = current.version + 1
      next.status = 'draft'
    }
    upsertLabel(next)
  }

  const matches = label.sample.filter((r) => r.matched)
  const misses = label.sample.filter((r) => !r.matched).slice(0, 5)

  return (
    <section className="screen">
      <div className="crumb"><LinkBtn to={{ name: 'labels' }}>Labels</LinkBtn> / Builder</div>
      <div className="row between">
        <h2>Label builder</h2>
        <button
          className="btn"
          onClick={() => patch({ tracked: !current.tracked, status: current.tracked ? current.status : 'active' })}
        >
          {label.tracked ? 'Stop tracking' : 'Track over time'}
        </button>
      </div>

      <p className="scope-strip">Simulated label workflow · Results use fixed demo fixtures and do not evaluate the definition. Existing aggregate figures are illustrative scenario data, separate from the 10 local call transcripts.</p>
      <div className="cols cols-even">
        <div className="box">
          <label>
            Label name
            <input className="input" value={label.name} onChange={(e) => patch({ name: e.target.value })} />
          </label>
          <label>
            Describe what to look for
            <textarea value={label.definition} onChange={(e) => patch({ definition: e.target.value })} />
          </label>
          <label>
            Examples that should match
            <textarea value={label.includeExamples} onChange={(e) => patch({ includeExamples: e.target.value })} />
          </label>
          <label>
            Examples that should not match
            <textarea value={label.excludeExamples} onChange={(e) => patch({ excludeExamples: e.target.value })} />
          </label>
          <label>
            Speaker focus
            <select className="select" value={label.speakerFocus} onChange={(e) => patch({ speakerFocus: e.target.value as LabelDef['speakerFocus'] })}>
              <option value="any">Any</option>
              <option value="customer">Customer</option>
              <option value="agent">Agent</option>
            </select>
          </label>
          <p className="small muted">Version {label.version} · {label.status}. Editing the definition creates a new version.</p>
          <div className="row">
            <button
              className="btn"
              disabled={busy !== null}
              onClick={() => {
                setBusy('sample')
                window.setTimeout(() => {
                  patch({
                    status: 'tested',
                    lastRun: new Date().toISOString().slice(0, 10),
                    sample: label.sample.length ? label.sample : seedSample(),
                  })
                  setBusy(null)
                }, 600)
              }}
            >
              {busy === 'sample' ? 'Simulating…' : `Simulate sample test (${label.sample.length || Math.min(INTERACTIONS.length, 5)} calls)`}
            </button>
            <button className="btn primary" disabled={label.status === 'draft'} onClick={() => setEstimate(true)}>
              Simulate full run
            </button>
          </div>
          {label.status === 'draft' ? <p className="small muted">A full run needs a sample test on this version first.</p> : null}
        </div>

        <div className="box">
          <h3>Results</h3>
          <div className="kpis">
            <Kpi label="Calls matched" value={pct(label.matchShare)} delta={`${label.matchedCount.toLocaleString()} of ${label.scopeCount.toLocaleString()}`} />
            <Kpi
              label="Agreement"
              value={label.agreement.reviewed ? `${label.agreement.correct} of ${label.agreement.reviewed}` : '—'}
              delta="reviewer verdicts on the sample"
            />
          </div>
          <Bars items={label.byQueue.map((q) => ({ name: q.queue, share: q.share }))} />
          <span className="small muted">
            Demo results are prewritten, not generated from your definition. Check each quoted excerpt against its linked transcript.
          </span>
        </div>
      </div>

      <div className="box">
        <h3>Example matches</h3>
        {label.sample.length === 0 ? (
          <Empty>Run a sample test to review matches and a few non-matches.</Empty>
        ) : (
          <ul className="list">
            {[...matches, ...misses].map((r) => (
              <li key={r.interactionId}>
                <div className="row between">
                  <LinkBtn to={{ name: 'call', id: r.interactionId, from: `label:${label.id}`, t: r.evidenceStart }}>
                    {r.interactionId} · {r.matched ? 'match' : 'non-match'} · {fmtTime(r.evidenceStart)} · {r.confidence}
                  </LinkBtn>
                  <div className="row" role="group" aria-label={`Is ${r.interactionId} a correct match?`}>
                    <span className="small muted">Correct?</span>
                    <button className="btn" aria-pressed={r.verdict === 'correct'} onClick={() => setVerdict(label.id, r.interactionId, 'correct')}>Yes</button>
                    <button className="btn" aria-pressed={r.verdict === 'incorrect'} onClick={() => setVerdict(label.id, r.interactionId, 'incorrect')}>No</button>
                  </div>
                </div>
                <div className="quote small">“{r.evidenceQuote}”</div>
                <span className="small muted">{r.reason}{r.grounded ? '' : ' · ungrounded'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {estimate ? (
        <dialog className="dialog" open>
          <div className="column" style={{ gap: 10 }}>
            <h3>Simulate a full run</h3>
            <p>This demo records a run status without processing calls or changing the fixture results. No LLM, tokens or warehouse compute are used.</p>
            <p className="small muted">Illustrative scope: {label.scopeCount.toLocaleString()} conversations. This is not an executed or measured result.</p>
            <div className="row">
              <button
                className="btn primary"
                onClick={() => {
                  patch({ status: label.tracked ? 'active' : 'ran', lastRun: new Date().toISOString().slice(0, 10) })
                  setEstimate(false)
                }}
              >
                Record simulated run
              </button>
              <button className="btn" onClick={() => setEstimate(false)}>Cancel</button>
            </div>
          </div>
        </dialog>
      ) : null}
    </section>
  )
}

function seedSample(): LabelDef['sample'] {
  return INTERACTIONS.slice(0, 5).map((c, i) => ({
    interactionId: c.id,
    matched: i < 3,
    confidence: 'medium' as const,
    evidenceQuote: c.segments.find((s) => s.role === 'customer')?.text ?? c.summary,
    evidenceStart: c.segments.find((s) => s.role === 'customer')?.start ?? 0,
    reason: 'Mock sample result for a new label.',
    grounded: true,
  }))
}
