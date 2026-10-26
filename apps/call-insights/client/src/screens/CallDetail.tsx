import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { CallDetail as Call, CallSegment } from '../../../shared/insights';
import { Async, Empty, LinkBtn } from '../components/ui';
import { useData, useSource } from '../data/source';
import { evidenceReturnPath, evidenceTime, returnLabel } from '../lib/evidence';
import { fmtDate, fmtDuration, fmtTime, pct } from '../lib/format';
import { toPath } from '../router';
import { highlight } from './Explore';

export function CallDetail() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const call = useData(`call:${id}`, (source) => source.call(id));
  const from = evidenceReturnPath(params.get('from'));
  const t = params.has('t') ? evidenceTime(params.get('t')) : undefined;
  return (
    <section className="screen">
      <Async value={call} label="Loading conversation…">
        {(data) => <CallBody key={`${data.id}:${t ?? 0}`} call={data} from={from} jump={t} />}
      </Async>
    </section>
  );
}

function CallBody({ call, from, jump }: { call: Call; from: string; jump?: number }) {
  const source = useSource();
  const audioUrl = call.audio ? source.audioUrl(call.id) : null;
  const duration = Math.max(call.durationSeconds, ...call.segments.map((s) => s.end), 1);
  const [time, setTime] = useState(() => clamp(jump ?? call.segments[0]?.start ?? 0, duration));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [query, setQuery] = useState(() => new URLSearchParams(from.split('?')[1] ?? '').get('q') ?? '');
  const [saveOpen, setSaveOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const currentTurn = useRef<HTMLButtonElement>(null);
  const player = usePlayer({ audioUrl, call, duration, speed, setTime, setPlaying });
  const segments = call.segments;
  const active = [...segments].reverse().find((s) => time >= s.start) ?? segments[0];
  const q = query.trim().toLowerCase();
  const turns = q ? segments.filter((s) => s.text?.toLowerCase().includes(q)) : segments;
  const withheld = segments.filter((s) => s.text == null).length;

  useEffect(() => {
    if (playing) currentTurn.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active?.idx, playing]);

  function seek(seconds: number) {
    const next = clamp(seconds, duration);
    setTime(next);
    player.seek(next);
  }

  return (
    <>
      <div className="crumb">
        <LinkBtn to={from}>← {returnLabel(from)}</LinkBtn>
        <span> / Review conversation</span>
      </div>
      <div className="row between">
        <div className="column">
          <span className="eyebrow">CONVERSATION EVIDENCE</span>
          <h2>
            {call.id} <span className="tag">{call.queue}</span>
          </h2>
          <span className="small muted">
            {fmtDate(call.startedAt)} · {fmtDuration(call.durationSeconds)} · {call.agentName}
            {call.contactReason ? ` · ${call.contactReason}` : ''}
          </span>
        </div>
        <div className="row">
          <button
            className="btn"
            type="button"
            onClick={() => void (async () => {
              try {
                const url = new URL(toPath({ name: 'call', id: call.id, t: Math.floor(time), from }), window.location.origin);
                await navigator.clipboard.writeText(url.href);
                setCopied('Moment link copied. Opening it still requires the recipient’s own access to this call.');
              } catch {
                setCopied('Clipboard unavailable. Copy the address bar after selecting a moment.');
              }
            })()}
          >
            Copy moment link
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              player.pause();
              setSaveOpen(true);
            }}
          >
            + Save evidence
          </button>
        </div>
      </div>
      {copied ? (
        <p className="small" role="status">
          {copied}
        </p>
      ) : null}
      <div className="trust-strip">
        <span className="status-dot" />
        {source.mode === 'fixtures' ? 'Fictional sample · account numbers hidden in this view' : 'Masked transcript · turns without a verified mask are withheld'}
        <span className="muted">
          {withheld ? `${withheld} of ${segments.length} turns withheld until masked · ` : ''}
          {call.enriched ? 'AI annotations need review' : 'No AI annotations for this call yet'}
        </span>
      </div>
      {call.themes.length ? (
        <div className="why">
          Part of{' '}
          {call.themes.map((theme, i) => (
            <span key={theme.id}>
              {i ? ', ' : ''}
              <LinkBtn to={{ name: 'theme', id: theme.id }}>
                <strong>{theme.name}</strong>
              </LinkBtn>
            </span>
          ))}
          .{' '}
          {active ? (
            <strong>
              Selected: {fmtTime(active.start)}–{fmtTime(active.end)}
            </strong>
          ) : null}
        </div>
      ) : null}

      <div className={`box player${audioUrl ? '' : ' synthetic-player'}`}>
        <div className="row between">
          <div className="row">
            <button
              className="btn primary"
              type="button"
              disabled={!player.available}
              onClick={() => (playing ? player.pause() : player.play(time))}
              aria-label={playing ? 'Pause' : audioUrl ? 'Play original recording' : 'Play synthetic voice preview'}
            >
              {playing ? 'Ⅱ Pause' : audioUrl ? '▶ Play recording' : '▶ Preview voice'}
            </button>
            <span className="player-time">
              {fmtTime(time)} <span className="muted">/ {fmtTime(duration)}</span>
            </span>
          </div>
          <label className="row small">
            Speed{' '}
            <select className="select" value={speed} disabled={!player.available} onChange={(e) => setSpeed(Number(e.target.value))}>
              <option value={0.75}>0.75×</option>
              <option value={1}>1×</option>
              <option value={1.5}>1.5×</option>
              <option value={2}>2×</option>
            </select>
          </label>
        </div>
        <p className="small muted">
          {audioUrl
            ? 'Original recording, streamed with your own permissions. The recording itself is unredacted.'
            : 'Synthetic voice preview of the fixture transcript, not an original recording. Timing is approximate.'}
        </p>
        {player.error ? (
          <p className="small warn" role="status">
            {player.error}
          </p>
        ) : null}
        {player.element}
        <input
          className="player-seek"
          type="range"
          min={0}
          max={duration}
          step={0.5}
          value={time}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
          aria-valuetext={`${fmtTime(time)} of ${fmtTime(duration)}`}
        />
        <Lane label="Agent" className="agent" duration={duration} segs={segments.filter((s) => s.role === 'agent')} time={time} />
        <Lane label="Customer" className="cust" duration={duration} segs={segments.filter((s) => s.role === 'customer')} time={time} />
        <div className="row small muted">
          <span>
            <span className="sw" style={{ background: 'var(--agent)' }} />
            Agent
          </span>
          <span>
            <span className="sw" style={{ background: 'var(--cust)' }} />
            Customer
          </span>
          <span>Choose a transcript turn or key moment to seek</span>
        </div>
      </div>

      <div className="detail-grid cols">
        <div className="box transcript-panel">
          <div className="row between">
            <h3>
              Transcript <span className="muted small">{segments.length} turns</span>
            </h3>
            <input className="input" style={{ width: 200 }} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find in transcript…" aria-label="Search transcript" />
          </div>
          <ul className="turns">
            {turns.map((s) => (
              <li key={s.idx} className={active?.idx === s.idx ? 'on' : ''}>
                <button
                  className="turn-button"
                  type="button"
                  ref={active?.idx === s.idx ? currentTurn : undefined}
                  onClick={() => seek(s.start)}
                  aria-current={active?.idx === s.idx ? 'true' : undefined}
                >
                  <span className="t">{fmtTime(s.start)}</span>
                  <span className={s.role === 'agent' ? 'who-a' : 'who-c'}>{s.role === 'agent' ? 'Agent' : s.role === 'customer' ? 'Customer' : 'Speaker'}</span>
                  <span>{s.text == null ? <em className="muted">Withheld until this turn is masked</em> : highlight(s.text, q)}</span>
                </button>
              </li>
            ))}
          </ul>
          {!turns.length ? (
            <Empty>
              No transcript turns match.{' '}
              <button className="link" type="button" onClick={() => setQuery('')}>
                Clear search
              </button>
            </Empty>
          ) : null}
          <div className="evidence-actions row between">
            <span className="small muted">Select a turn, then save it with your note.</span>
            <button className="btn" type="button" onClick={() => setSaveOpen(true)}>
              Save selected turn
            </button>
          </div>
        </div>
        <div className="column evidence-panel" style={{ gap: 16 }}>
          <div className="box">
            <div className="row between">
              <h3>Conversation summary</h3>
              <span className="tag">AI · review</span>
            </div>
            {call.enriched ? (
              <>
                <p>{call.summary ?? 'No summary.'}</p>
                <div className="row">
                  {call.resolution ? <span className="tag">{call.resolution}</span> : null}
                  {call.sentimentEnd ? (
                    <span className="tag">
                      {cap(call.sentimentStart ?? 'unknown')} → {call.sentimentEnd}
                    </span>
                  ) : null}
                  <span className="tag">
                    {call.repeatContactMentioned == null ? 'Repeat mention not evaluated' : call.repeatContactMentioned ? 'Repeat contact mentioned' : 'No repeat mention'}
                  </span>
                </div>
                <p className="small muted">A repeat-contact mention is not a measured repeat-contact outcome.</p>
              </>
            ) : (
              <p className="muted">This call has not been annotated yet. Its transcript and metrics are still available.</p>
            )}
          </div>
          <div className="box">
            <div className="row between">
              <h3>Key moments</h3>
              <span className="tag">{call.moments.length}</span>
            </div>
            {call.moments.length ? (
              <ol className="list">
                {call.moments.map((m, i) => (
                  <li key={`${m.label}:${m.start}`}>
                    <button className="link" type="button" onClick={() => seek(m.start)}>
                      <span className="small muted">
                        {String(i + 1).padStart(2, '0')} · {fmtTime(m.start)}
                      </span>{' '}
                      {m.label}
                    </button>
                    <span className="small muted">{m.quote ? `“${m.quote}”` : 'Quote not found in the masked transcript · verify timing'}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted small">No key moments recorded.</p>
            )}
          </div>
          <div className="box">
            <h3>Conversation signals</h3>
            <dl>
              <dt>Talk ratio · agent / customer</dt>
              <dd>{call.talkRatioAgent != null ? `${pct(call.talkRatioAgent)} / ${pct(1 - call.talkRatioAgent)}` : '—'}</dd>
              <dt>Longest silence</dt>
              <dd>{call.longestSilenceSeconds != null ? `${Math.round(call.longestSilenceSeconds)}s` : '—'}</dd>
              <dt>Overtalk</dt>
              <dd>{call.overtalkCount ?? '—'}</dd>
              <dt>Holds</dt>
              <dd>{call.holdCount ?? '—'}</dd>
              <dt>Transfers (AI)</dt>
              <dd>{call.transferCount ?? '—'}</dd>
            </dl>
          </div>
        </div>
      </div>
      {saveOpen ? <SaveEvidence call={call} initial={active} onClose={() => setSaveOpen(false)} /> : null}
    </>
  );
}

/** Original audio when available, otherwise browser speech over the (fixture) transcript. */
function usePlayer({
  audioUrl,
  call,
  duration,
  speed,
  setTime,
  setPlaying,
}: {
  audioUrl: string | null;
  call: Call;
  duration: number;
  speed: number;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const speechRun = useRef(0);
  const speaking = useRef(false);
  const [error, setError] = useState('');
  const voice = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed]);
  useEffect(
    () => () => {
      speechRun.current += 1;
      if (voice) window.speechSynthesis.cancel();
    },
    [voice]
  );

  function speakFrom(position: number) {
    const token = ++speechRun.current;
    window.speechSynthesis.cancel();
    speaking.current = true;
    setPlaying(true);
    const start = call.segments.findIndex((s) => s.end > position);
    const speak = (index: number) => {
      if (token !== speechRun.current) return;
      const segment = call.segments[index];
      if (!segment) {
        speaking.current = false;
        setPlaying(false);
        setTime(duration);
        return;
      }
      if (!segment.text) return speak(index + 1);
      const utterance = new SpeechSynthesisUtterance(segment.text);
      utterance.lang = 'en-AU';
      utterance.rate = speed;
      utterance.onstart = () => token === speechRun.current && setTime(segment.start);
      utterance.onend = () => speak(index + 1);
      utterance.onerror = (event) => {
        if (token !== speechRun.current || event.error === 'interrupted' || event.error === 'canceled') return;
        speaking.current = false;
        setPlaying(false);
        setError('Voice preview is unavailable in this browser. You can still review and save the transcript.');
      };
      window.speechSynthesis.speak(utterance);
    };
    speak(start < 0 ? 0 : start);
  }

  return {
    available: Boolean(audioUrl) || voice,
    error,
    element: audioUrl ? (
      <audio
        ref={audio}
        src={audioUrl}
        preload="metadata"
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setError('The original recording could not be loaded. You may not have access to the audio volume.')}
      />
    ) : null,
    play(position: number) {
      setError('');
      if (audio.current) {
        audio.current.currentTime = position;
        audio.current.play().catch(() => setError('Playback was blocked. Press play again.'));
      } else if (voice) speakFrom(position);
    },
    pause() {
      if (audio.current) audio.current.pause();
      else if (voice) {
        speechRun.current += 1;
        speaking.current = false;
        window.speechSynthesis.cancel();
        setPlaying(false);
      }
    },
    seek(position: number) {
      if (audio.current) audio.current.currentTime = position;
      else if (speaking.current) speakFrom(position);
    },
  };
}

function SaveEvidence({ call, initial, onClose }: { call: Call; initial?: CallSegment; onClose: () => void }) {
  const source = useSource();
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const cases = useData('cases:list', (s) => s.cases.list());
  const startIndex = Math.max(0, call.segments.findIndex((s) => s.idx === initial?.idx));
  const [from, setFrom] = useState(startIndex);
  const [to, setTo] = useState(startIndex);
  const [caseId, setCaseId] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = call.segments.slice(from, to + 1);
  const withheld = selected.some((s) => s.text == null);
  const editable = useMemo(() => (cases.data ?? []).filter((c) => !c.shared), [cases.data]);
  const target = caseId || editable[0]?.id || '';

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const record = target === '' || caseId === 'new' ? await source.cases.create(title.trim()) : await source.cases.get(target);
      await source.cases.addItem(record.id, { type: 'clip', interactionId: call.id, start: selected[0].start, end: selected[selected.length - 1].end, note: note.trim() }, record.version);
      dialog.current?.close();
      void navigate(toPath({ name: 'case', id: record.id }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The evidence could not be saved.');
      setBusy(false);
    }
  }
  const creating = caseId === 'new' || (!editable.length && cases.data !== undefined);
  return (
    <dialog className="dialog save-dialog" ref={dialog} onClose={onClose}>
      <form
        className="column"
        style={{ gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <span className="eyebrow">BUILD YOUR FINDING</span>
        <h3>Save conversation evidence</h3>
        <div className="row">
          <label>
            From
            <select
              className="select"
              value={from}
              onChange={(e) => {
                const next = Number(e.target.value);
                setFrom(next);
                setTo(Math.max(next, to));
              }}
            >
              {call.segments.map((s, i) => (
                <option key={s.idx} value={i}>
                  {fmtTime(s.start)} · {s.role}
                </option>
              ))}
            </select>
          </label>
          <label>
            To
            <select className="select" value={to} onChange={(e) => setTo(Number(e.target.value))}>
              {call.segments.map((s, i) =>
                i >= from ? (
                  <option key={s.idx} value={i}>
                    {fmtTime(s.end)} · {s.role}
                  </option>
                ) : null
              )}
            </select>
          </label>
        </div>
        <blockquote className="quote">{selected.map((s) => s.text ?? '[withheld]').join(' ')}</blockquote>
        {withheld ? <p className="small warn">This range includes a withheld turn. Choose turns that are fully masked.</p> : null}
        <label>
          Investigation
          <select className="select" value={creating ? 'new' : target} onChange={(e) => setCaseId(e.target.value)} disabled={!cases.data}>
            {editable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
            <option value="new">+ Create a new case</option>
          </select>
        </label>
        {creating ? (
          <label>
            Case title
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="What are you investigating?" maxLength={160} />
          </label>
        ) : null}
        <label>
          Analyst note
          <textarea value={note} onChange={(e) => setNote(e.target.value)} required placeholder="What does this excerpt support? Include any uncertainty." rows={3} maxLength={4000} />
        </label>
        {error ? (
          <p className="small warn" role="alert">
            {error}
          </p>
        ) : null}
        <p className="small muted">
          {source.mode === 'fixtures'
            ? 'Stored in this browser only.'
            : 'Saved to your investigations. Source access and masking are checked again whenever the case is opened or shared.'}
        </p>
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy || withheld || !note.trim() || (creating && !title.trim())}>
            {busy ? 'Saving…' : 'Save to case →'}
          </button>
          <button className="btn" type="button" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}

function Lane({ label, className, duration, segs, time }: { label: string; className: string; duration: number; segs: CallSegment[]; time: number }) {
  return (
    <div className={`lane ${className}`}>
      <span>{label}</span>
      <div className="track" role="img" aria-label={`${label} speaking segments`}>
        {segs.map((s) => (
          <s key={s.idx} style={{ left: `${(s.start / duration) * 100}%`, width: `${((s.end - s.start) / duration) * 100}%` }} />
        ))}
        <div className="playhead" style={{ left: `${(time / duration) * 100}%` }} />
      </div>
    </div>
  );
}

function clamp(time: number, duration: number) {
  return Math.min(duration, Math.max(0, Number.isFinite(time) ? time : 0));
}
function cap(s: string) {
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}
