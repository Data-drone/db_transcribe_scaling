import { useEffect, useMemo, useRef, useState } from 'react'
import { Empty, LinkBtn } from '../components/ui'
import { THEMES, interactionById } from '../data'
import { fmtDate, fmtDuration, fmtTime, pct } from '../format'
import { maskedText } from '../privacy'
import { go } from '../router'
import { useStore } from '../store'
import type { Interaction, Segment } from '../types'

export function CallDetail({ id, from, t }: { id: string; from?: string; t?: number }) {
  const call = interactionById(id)
  if (!call) return <section className="screen"><Empty>Call not found. <LinkBtn to={{ name: 'explore' }}>Return to Explore</LinkBtn></Empty></section>
  return <CallBody key={`${id}:${t ?? 0}`} call={call} from={from} jump={t} />
}

function CallBody({ call, from, jump }: { call: Interaction; from?: string; jump?: number }) {
  const { labels, cases, addCase, addCaseItem, storageStatus } = useStore()
  const duration = call.durationSeconds
  const [time, setTime] = useState(() => clamp(jump ?? 0, duration))
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [voiceAvailable] = useState(() => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window)
  const [voiceError, setVoiceError] = useState('')
  const [query, setQuery] = useState(() => from?.startsWith('#/explore') ? new URLSearchParams(from.split('?')[1]).get('q') ?? '' : '')
  const [clipNote, setClipNote] = useState('')
  const [caseId, setCaseId] = useState(cases[0]?.id ?? '')
  const [newCaseTitle, setNewCaseTitle] = useState('')
  const [clipOpen, setClipOpen] = useState(false)
  const [clipStart, setClipStart] = useState(0)
  const [clipEnd, setClipEnd] = useState(0)
  const [copied, setCopied] = useState('')
  const speechRun = useRef(0)
  const isPlaying = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const currentTurn = useRef<HTMLButtonElement>(null)
  const voiceStartup = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const active = [...call.segments].reverse().find((s) => time >= s.start) ?? call.segments[0]
  const q = query.trim().toLowerCase()
  const turns = q ? call.segments.filter((s) => maskedText(s.text).toLowerCase().includes(q)) : call.segments
  const moments = useMemo(() => call.keyMoments.map((m) => {
    const source = call.segments.find((s) => s.text.includes(m.quote))
    return { ...m, start: source?.start ?? m.start, grounded: Boolean(source) }
  }), [call])
  const selectedTurns = call.segments.slice(clipStart, clipEnd + 1)
  const returnHash = returnOrigin(from)
  const returnLabel = returnHash.startsWith('#/cases/') ? 'Back to case' : returnHash.startsWith('#/themes/') ? 'Back to theme' : returnHash.startsWith('#/labels/') ? 'Back to label' : 'Back to results'

  useEffect(() => {
    return () => {
      clearTimeout(voiceStartup.current)
      speechRun.current += 1
      isPlaying.current = false
      if (voiceAvailable) window.speechSynthesis.cancel()
    }
  }, [voiceAvailable])

  useEffect(() => {
    if (playing) currentTurn.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active.idx, playing])

  useEffect(() => {
    if (clipOpen && !dialog.current?.open) dialog.current?.showModal()
    if (!clipOpen && dialog.current?.open) dialog.current?.close()
  }, [clipOpen])

  function stopPreview() {
    clearTimeout(voiceStartup.current)
    speechRun.current += 1
    isPlaying.current = false
    setPlaying(false)
    if (voiceAvailable) window.speechSynthesis.cancel()
  }

  function startPreview(position: number, rate = speed) {
    if (!voiceAvailable) return
    const token = ++speechRun.current
    clearTimeout(voiceStartup.current)
    window.speechSynthesis.cancel()
    setVoiceError('')
    isPlaying.current = true
    setPlaying(true)
    const startIndex = call.segments.findIndex((s) => s.end > position)
    const speakTurn = (index: number) => {
      if (token !== speechRun.current) return
      const segment = call.segments[index]
      if (!segment) {
        isPlaying.current = false
        setPlaying(false)
        setTime(duration)
        return
      }
      const text = maskedText(segment.text)
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'en-AU'
      utterance.rate = rate
      utterance.onstart = () => {
        if (token !== speechRun.current) return
        clearTimeout(voiceStartup.current)
        setTime(segment.start)
      }
      utterance.onboundary = (event) => {
        if (token === speechRun.current) setTime(segment.start + (event.charIndex / Math.max(text.length, 1)) * (segment.end - segment.start))
      }
      utterance.onend = () => speakTurn(index + 1)
      utterance.onerror = (event) => {
        if (token !== speechRun.current || event.error === 'interrupted' || event.error === 'canceled') return
        clearTimeout(voiceStartup.current)
        isPlaying.current = false
        setPlaying(false)
        setVoiceError('Voice preview is unavailable. You can still review and save the transcript.')
      }
      voiceStartup.current = setTimeout(() => {
        if (token !== speechRun.current) return
        stopPreview()
        setVoiceError('This browser did not start a voice preview. You can still review and save the transcript.')
      }, 5000)
      window.speechSynthesis.speak(utterance)
    }
    speakTurn(startIndex < 0 ? 0 : startIndex)
  }

  function seek(sec: number) {
    const next = clamp(sec, duration)
    setTime(next)
    if (isPlaying.current) startPreview(next)
  }

  function openEvidence() {
    stopPreview()
    const index = call.segments.findIndex((s) => s.idx === active.idx)
    setClipStart(index)
    setClipEnd(index)
    setClipNote('')
    setClipOpen(true)
  }

  return (
    <section className="screen">
      <div className="crumb"><a className="link" href={returnHash}>← {returnLabel}</a><span> / Review conversation</span></div>
      <div className="row between">
        <div className="column">
          <span className="eyebrow">CONVERSATION EVIDENCE</span>
          <h2>{call.id} <span className="tag">{call.queue}</span></h2>
          <span className="small muted">{fmtDate(call.startedAt)} · {fmtDuration(duration)} · {call.agentName} · {call.contactReason}</span>
        </div>
        <div className="row">
          <button className="btn" onClick={async () => {
            try {
              const url = new URL(window.location.href)
              const params = new URLSearchParams({ t: String(Math.floor(time)), from: returnHash })
              url.hash = `/calls/${call.id}?${params}`
              await navigator.clipboard.writeText(url.href)
              setCopied('Moment link copied for this local demo.')
            } catch { setCopied('Clipboard unavailable. Copy the address after selecting a moment.') }
          }}>Copy moment link</button>
          <button className="btn primary" onClick={openEvidence}>+ Save evidence</button>
        </div>
      </div>
      {copied ? <p className="small" role="status">{copied}</p> : null}
      <div className="trust-strip">
        <span className="status-dot" /> Fictional sample · account numbers hidden in this view
        <span className="muted">Production masking status: not evaluated · AI annotations need review</span>
      </div>
      <div className="why">{whyHere(call, from, jump)} <strong>Selected: {fmtTime(active.start)}–{fmtTime(active.end)}</strong></div>

      <div className="box player synthetic-player">
        <div className="row between">
          <div className="row">
            <button className="btn primary" disabled={!voiceAvailable} onClick={() => playing ? stopPreview() : startPreview(time)} aria-label={playing ? 'Pause synthetic voice preview' : 'Play synthetic voice preview'}>{playing ? 'Ⅱ Pause' : '▶ Preview voice'}</button>
            <span className="player-time">{fmtTime(time)} <span className="muted">/ {fmtTime(duration)}</span></span>
          </div>
          <label className="row small">Speed <select className="select" value={speed} disabled={!voiceAvailable} onChange={(e) => {
            const next = Number(e.target.value)
            setSpeed(next)
            if (isPlaying.current) startPreview(time, next)
          }}><option value={0.75}>0.75×</option><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></label>
        </div>
        <p className="small muted">Synthetic voice preview, not the original recording. Reads the mock transcript from the selected turn; original gaps are skipped and timing is approximate.</p>
        {(!voiceAvailable || voiceError) ? <p className="small warn" role="status">{voiceError || 'This browser does not provide speech synthesis. Original call audio is unavailable in the mock.'}</p> : null}
        <input className="player-seek" type="range" min={0} max={duration} step={1} value={Math.floor(time)} onChange={(e) => seek(Number(e.target.value))} aria-label="Seek to transcript timestamp" aria-valuetext={`${fmtTime(time)} of ${fmtTime(duration)}`} />
        <Lane label="Agent" className="agent" duration={duration} segs={call.segments.filter((s) => s.role === 'agent')} time={time} />
        <Lane label="Customer" className="cust" duration={duration} segs={call.segments.filter((s) => s.role === 'customer')} time={time} />
        <div className="row small muted"><span><span className="sw" style={{ background: 'var(--agent)' }} />Agent</span><span><span className="sw" style={{ background: 'var(--cust)' }} />Customer</span><span>Choose a transcript turn or key moment to seek</span></div>
      </div>

      <div className="detail-grid cols">
        <div className="box transcript-panel">
          <div className="row between"><h3>Transcript <span className="muted small">{call.segments.length} turns</span></h3><input className="input" style={{ width: 200 }} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find in transcript…" aria-label="Search transcript" /></div>
          <ul className="turns">
            {turns.map((s) => <li key={s.idx} className={active.idx === s.idx ? 'on' : ''}>
              <button className="turn-button" ref={active.idx === s.idx ? currentTurn : undefined} onClick={() => seek(s.start)} aria-label={`${s.role} at ${fmtTime(s.start)}: ${maskedText(s.text)}`} aria-current={active.idx === s.idx ? 'true' : undefined}>
                <span className="t">{fmtTime(s.start)}</span><span className={s.role === 'agent' ? 'who-a' : 'who-c'}>{s.role === 'agent' ? 'Agent' : 'Customer'}</span><span>{highlight(maskedText(s.text), q)}{s.event ? <span className="event"> · {s.event}</span> : null}</span>
              </button>
            </li>)}
          </ul>
          {!turns.length ? <Empty>No transcript turns match. <button className="link" onClick={() => setQuery('')}>Clear search</button></Empty> : null}
          <div className="evidence-actions row between"><span className="small muted">Select a turn, then save it with your note.</span><button className="btn" onClick={openEvidence}>Save selected turn</button></div>
        </div>
        <div className="column evidence-panel" style={{ gap: 16 }}>
          <div className="box"><div className="row between"><h3>Conversation summary</h3><span className="tag">AI · review</span></div><p>{call.summary}</p><div className="row"><span className="tag">{call.resolution}</span><span className="tag">{cap(call.sentimentStart)} → {call.sentimentEnd}</span>{call.repeatContact ? <span className="tag">Repeat contact mentioned</span> : <span className="tag">No repeat mention in sample</span>}{call.labels.map((lid) => <LinkBtn key={lid} className="tag" to={{ name: 'label', id: lid }}>{labels.find((x) => x.id === lid)?.name ?? lid}</LinkBtn>)}</div><p className="small muted">Annotations are illustrative. A repeat-contact mention is not a measured repeat-contact outcome.</p></div>
          <div className="box"><div className="row between"><h3>Key moments</h3><span className="tag">{moments.length}</span></div><ol className="list">{moments.map((m, i) => <li key={m.label}><button className="link" onClick={() => seek(m.start)}><span className="small muted">{String(i + 1).padStart(2, '0')} · {fmtTime(m.start)}</span> {m.label}</button><span className="small muted">“{maskedText(m.quote)}”{m.grounded ? '' : ' · Quote/timing needs verification'}</span></li>)}</ol></div>
          <div className="box"><h3>Conversation signals</h3><dl><dt>Talk ratio · agent / customer</dt><dd>{pct(call.talkRatioAgent)} / {pct(1 - call.talkRatioAgent)}</dd><dt>Longest silence</dt><dd>{call.longestSilence}s</dd><dt>Overtalk</dt><dd>{call.overtalkCount}</dd><dt>Transfers</dt><dd>{call.transferCount}</dd></dl><p className="small muted">Mock measurements for this conversation.</p></div>
        </div>
      </div>
      <dialog className="dialog save-dialog" ref={dialog} onCancel={() => setClipOpen(false)} onClose={() => setClipOpen(false)}>
        <form className="column" style={{ gap: 16 }} onSubmit={(e) => {
          e.preventDefault()
          const target = caseId || addCase(newCaseTitle)
          addCaseItem(target, { type: 'clip', refId: call.id, start: selectedTurns[0].start, end: selectedTurns[selectedTurns.length - 1].end, note: clipNote.trim() })
          setClipOpen(false)
          go({ name: 'case', id: target })
        }}>
          <span className="eyebrow">BUILD YOUR FINDING</span><h3>Save conversation evidence</h3>
          <div className="row"><label>From<select className="select" value={clipStart} onChange={(e) => { const next = Number(e.target.value); setClipStart(next); setClipEnd(Math.max(next, clipEnd)) }}>{call.segments.map((s, i) => <option key={s.idx} value={i}>{fmtTime(s.start)} · {s.role}</option>)}</select></label><label>To<select className="select" value={clipEnd} onChange={(e) => setClipEnd(Number(e.target.value))}>{call.segments.map((s, i) => i >= clipStart ? <option key={s.idx} value={i}>{fmtTime(s.end)} · {s.role}</option> : null)}</select></label></div>
          <blockquote className="quote">{selectedTurns.map((s) => maskedText(s.text)).join(' ')}</blockquote>
          <label>Investigation<select className="select" value={caseId} onChange={(e) => setCaseId(e.target.value)}>{cases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}<option value="">+ Create a new case</option></select></label>
          {!caseId ? <label>Case title<input className="input" value={newCaseTitle} onChange={(e) => setNewCaseTitle(e.target.value)} required placeholder="What are you investigating?" maxLength={120} /></label> : null}
          <label>Analyst note<textarea value={clipNote} onChange={(e) => setClipNote(e.target.value)} required placeholder="What does this excerpt support? Include any uncertainty." rows={3} maxLength={2000} /></label>
          <p className="small muted">{storageStatus === 'saved' ? 'Stored in this browser. Original recordings and permissioned sharing are not connected.' : 'Browser storage is unavailable. Evidence will last for this session only.'}</p>
          <div className="row"><button className="btn primary" type="submit" disabled={!clipNote.trim() || (!caseId && !newCaseTitle.trim())}>Save to case →</button><button className="btn" type="button" onClick={() => setClipOpen(false)}>Cancel</button></div>
        </form>
      </dialog>
    </section>
  )
}

function Lane({ label, className, duration, segs, time }: { label: string; className: string; duration: number; segs: Segment[]; time: number }) {
  return <div className={`lane ${className}`}><span>{label}</span><div className="track" role="img" aria-label={`${label} speaking segments`}>{segs.map((s) => <s key={s.idx} style={{ left: `${(s.start / duration) * 100}%`, width: `${((s.end - s.start) / duration) * 100}%` }} />)}<div className="playhead" style={{ left: `${(time / duration) * 100}%` }} /></div></div>
}

function whyHere(call: Interaction, from?: string, t?: number) {
  if (from?.startsWith('#/explore')) {
    const keyword = new URLSearchParams(from.split('?')[1]).get('q')
    return <>Opened from your filtered results{keyword ? <> · matching “{keyword}”</> : null}. </>
  }
  if (from?.startsWith('#/cases/')) return <>Reviewing saved case evidence. </>
  if (from?.startsWith('label:') || from?.startsWith('#/labels/')) return <>Opened from a sample label match. </>
  const sourceTheme = from?.startsWith('theme:') ? from.slice(6) : from?.startsWith('#/themes/') ? from.split('/')[2].split('?')[0] : call.themes[0]
  const theme = THEMES.find((th) => th.id === sourceTheme)
  return <>{theme ? <>Related to <strong>{theme.name}</strong>. </> : 'Reviewing this conversation. '}{t != null ? `Opened at ${fmtTime(t)}. ` : ''}</>
}

function returnOrigin(from?: string) {
  if (from && /^#\/(?:explore(?:\?|$)|(?:cases|themes|labels)\/[\w-]+(?:\?|$))/.test(from)) return from
  const legacy = /^(theme|label):([\w-]+)$/.exec(from ?? '')
  if (legacy) return `#/${legacy[1] === 'theme' ? 'themes' : 'labels'}/${legacy[2]}`
  return '#/explore'
}

function highlight(text: string, q: string) {
  if (!q) return text
  const i = text.toLowerCase().indexOf(q)
  return i < 0 ? text : <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}
function clamp(time: number, duration: number) { return Math.min(duration, Math.max(0, Number.isFinite(time) ? time : 0)) }
function cap(s: string) { return s.slice(0, 1).toUpperCase() + s.slice(1) }
