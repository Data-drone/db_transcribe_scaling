import { useMemo, useRef, useState } from 'react'
import { Empty, Kpi, LinkBtn } from '../components/ui'
import { INTERACTIONS, themeById } from '../data'
import { fmtTime } from '../format'
import { maskedText } from '../privacy'
import { go } from '../router'
import { useStore } from '../store'
import type { CaseRecord } from '../types'

export function Cases() {
  const { cases, addCase, storageStatus } = useStore()
  const [title, setTitle] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <section className="screen">
      <div className="row between"><div className="column"><span className="eyebrow">FROM CONVERSATION TO CHANGE</span><h2>Investigation cases</h2><span className="small muted">Collect moments, add your reasoning, and build an evidence-backed finding.</span></div><button className="btn primary" onClick={() => dialog.current?.showModal()}>+ New case</button></div>
      <div className="trust-strip"><span className="status-dot" /> {storageStatus === 'saved' ? 'Cases saved in this browser' : 'Browser storage unavailable · session only'}<span className="muted">Local mock · links do not grant access or transfer saved evidence</span></div>
      {cases.length === 0 ? <Empty>No cases yet. <LinkBtn to={{ name: 'explore' }}>Find a conversation</LinkBtn> and save a moment to start investigating.</Empty> : <div className="case-grid">{cases.map((c) => {
        const clips = c.items.filter((it) => it.type === 'clip')
        return <article className="box case-card" key={c.id}><div className="row between"><span className="tag">INVESTIGATION</span><span className="small muted">{c.updatedAt}</span></div><h3><LinkBtn to={{ name: 'case', id: c.id }}>{c.title}</LinkBtn></h3><p className="muted small">{c.items.find((it) => it.note)?.note || 'An open question, ready for evidence.'}</p><div className="row between"><span className="small muted">{clips.length} excerpts · {new Set(clips.map((it) => it.refId)).size} calls</span><LinkBtn to={{ name: 'case', id: c.id }}>Open case →</LinkBtn></div></article>
      })}</div>}
      <dialog className="dialog" ref={dialog}><form className="column" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); const id = addCase(title); dialog.current?.close(); setTitle(''); go({ name: 'case', id }) }}><span className="eyebrow">START AN INVESTIGATION</span><h3>What are you looking into?</h3><label>Case title<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example, repeat calls after a payment dispute" required maxLength={120} autoFocus /></label><p className="small muted">Your case is stored locally in this browser.</p><div className="row"><button className="btn primary" type="submit">Create case</button><button className="btn" type="button" onClick={() => dialog.current?.close()}>Cancel</button></div></form></dialog>
    </section>
  )
}

export function CaseDetail({ id }: { id: string }) {
  const { cases, addCaseItem, renameCase, storageStatus } = useStore()
  const rec = cases.find((c) => c.id === id)
  const [message, setMessage] = useState('')
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(rec?.title ?? '')
  const brief = useMemo(() => rec ? briefMarkdown(rec) : '', [rec])
  if (!rec) return <section className="screen"><Empty>This case is not saved in this browser. Local demo links do not transfer case data. <LinkBtn to={{ name: 'cases' }}>Return to cases</LinkBtn></Empty></section>
  const clips = rec.items.filter((it) => it.type === 'clip')
  const uniqueCalls = new Set(clips.map((it) => it.refId)).size
  const notes = rec.items.filter((it) => it.type === 'note')

  return (
    <section className="screen">
      <div className="crumb"><LinkBtn to={{ name: 'cases' }}>← All cases</LinkBtn><span> / Investigation</span></div>
      <div className="row between"><div className="column"><span className="eyebrow">EVIDENCE WORKSPACE</span>{editing ? <form className="row" onSubmit={(e) => { e.preventDefault(); renameCase(id, title); setEditing(false) }}><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Case title" required maxLength={120} autoFocus /><button className="btn primary" type="submit">Save title</button><button className="btn" type="button" onClick={() => setEditing(false)}>Cancel</button></form> : <h2>{rec.title} <button className="link small" onClick={() => { setTitle(rec.title); setEditing(true) }}>Rename</button></h2>}<span className="small muted">Owner {rec.owner} · updated {rec.updatedAt}</span></div><div className="row"><button className="btn" onClick={async () => {
        try { const url = new URL(window.location.href); url.hash = `/cases/${id}`; await navigator.clipboard.writeText(url.href); setMessage('Local case link copied. It reopens evidence saved in this browser; it does not share data or permissions.') } catch { setMessage('Clipboard unavailable. You can copy this case URL from the address bar.') }
      }}>Copy local link</button><button className="btn primary" onClick={() => {
        const url = URL.createObjectURL(new Blob([brief], { type: 'text/markdown' }))
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${rec.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'investigation'}-brief.md`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage('Brief exported with source timestamps and the limits of this mock dataset.')
      }}>Export brief ↗</button></div></div>
      {message ? <p className="small" role="status">{message}</p> : null}
      <div className="trust-strip"><span className="status-dot" /> {storageStatus === 'saved' ? 'Saved in this browser' : 'Storage unavailable · changes last for this session'}<span className="muted">Fictional evidence · original recordings and permissioned sharing are not connected</span></div>
      <div className="kpis"><Kpi label="Saved excerpts" value={String(clips.length)} delta="Timestamped transcript evidence" /><Kpi label="Conversations with evidence" value={String(uniqueCalls)} delta="Unique calls with saved excerpts" /><Kpi label="Analyst notes" value={String(notes.length + clips.filter((it) => it.note).length)} delta="Your interpretation alongside sources" /><Kpi label="Evidence scope" value="Mock" delta="No measured business outcomes" /></div>
      <div className="detail-grid cols">
        <div className="box"><div className="row between"><h3>Collected evidence</h3><LinkBtn to={{ name: 'explore' }}>+ Find more calls</LinkBtn></div><p className="small muted">Open each source to inspect the surrounding conversation before drawing a conclusion.</p>{!rec.items.length ? <Empty>This case is ready for evidence. <LinkBtn to={{ name: 'explore' }}>Explore conversations →</LinkBtn></Empty> : <div className="column" style={{ gap: 16 }}>{rec.items.filter((it) => it.type !== 'note').map((it, index) => {
          const call = INTERACTIONS.find((c) => c.id === it.refId)
          if (it.type === 'clip' && call) {
            const text = call.segments.filter((s) => s.end > (it.start ?? 0) && s.start < (it.end ?? call.durationSeconds)).map((s) => maskedText(s.text)).join(' ')
            return <article className="evidence-card" key={it.id}><div className="row between"><span className="eyebrow">EVIDENCE {String(index + 1).padStart(2, '0')}</span><span className="tag">{call.queue}</span></div><h4><LinkBtn to={{ name: 'call', id: call.id, t: it.start, from: `#/cases/${id}` }}>{call.id} · {fmtTime(it.start ?? 0)}–{fmtTime(it.end ?? 0)} ↗</LinkBtn></h4><blockquote className="quote">“{text}”</blockquote><p className="small"><strong>Analyst note</strong><br />{it.note || 'No interpretation added.'}</p><span className="small muted">Fictional transcript · original audio unavailable</span></article>
          }
          if (it.type === 'theme') return <article className="evidence-card" key={it.id}><span className="eyebrow">CONTEXT</span><h4><LinkBtn to={{ name: 'theme', id: it.refId }}>{themeById(it.refId)?.name ?? it.refId}</LinkBtn></h4><p className="small">{it.note}</p><span className="small muted">Scenario context; theme totals are illustrative, not measured from saved evidence.</span></article>
          return <article className="evidence-card" key={it.id}><strong>{it.type}: {it.refId}</strong><p className="small">{it.note}</p></article>
        })}</div>}</div>
        <div className="column" style={{ gap: 16 }}><div className="box"><h3>Analyst notebook</h3><p className="small muted">Capture your hypothesis, counterexamples, and what you still need to verify.</p>{notes.map((it) => <p key={it.id} className="quote small">{it.note}</p>)}<form className="column" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); addCaseItem(id, { type: 'note', refId: id, note: note.trim() }); setNote(''); setMessage('Note added to this case.') }}><label className="sr-only" htmlFor="case-note">Add an analyst note</label><textarea id="case-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} required maxLength={3000} placeholder="What does the evidence suggest?" /><button className="btn" type="submit" disabled={!note.trim()}>Add note</button></form></div><div className="box"><h3>Before you share a finding</h3><ul className="list small"><li>These excerpts are a small fictional sample.</li><li>Synthetic voice cannot verify transcription accuracy.</li><li>Confirm outcomes using operational data.</li><li>Exported briefs include these limitations.</li></ul></div></div>
      </div>
      <details className="box"><summary>Preview exported brief</summary><pre className="sql">{brief}</pre></details>
    </section>
  )
}

function briefMarkdown(rec: CaseRecord) {
  const sources = rec.items.map((it) => {
    const call = INTERACTIONS.find((c) => c.id === it.refId)
    if (it.type === 'clip' && call) {
      const excerpt = call.segments.filter((s) => s.end > (it.start ?? 0) && s.start < (it.end ?? call.durationSeconds)).map((s) => maskedText(s.text)).join(' ')
      const url = new URL(window.location.href); url.hash = `/calls/${call.id}?t=${it.start ?? 0}`
      return `- **${call.id}, ${fmtTime(it.start ?? 0)}–${fmtTime(it.end ?? 0)}** (${call.queue})\n  > ${excerpt}\n  Analyst note: ${it.note || 'None'}\n  Local source: ${url.href}`
    }
    return `- ${it.type === 'note' ? 'Analyst note' : 'Scenario context'}: ${it.note}`
  }).join('\n\n')
  return `# ${rec.title}\n\nOwner: ${rec.owner} · Updated: ${rec.updatedAt}\n\n## Evidence and analyst notes\n\n${sources || 'No evidence collected yet.'}\n\n## Scope and limitations\n\nThis is a local prototype using fictional conversations. Saved excerpts are a selected sample, not a measured population. Original call recordings are unavailable; the browser voice preview reads synthetic text and cannot verify ASR accuracy. AI annotations and scenario totals require independent verification. No causal or financial impact has been established. Local links require the running prototype, and saved cases exist only in the originating browser.\n`
}

