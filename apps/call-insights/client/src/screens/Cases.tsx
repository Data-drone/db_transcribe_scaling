import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { Investigation } from '../../../shared/investigations';
import { Async, Empty, Kpi, LinkBtn } from '../components/ui';
import { useData, useSource } from '../data/source';
import { fmtDate, fmtTime } from '../lib/format';
import { toPath } from '../router';

export function Cases() {
  const source = useSource();
  const navigate = useNavigate();
  const cases = useData('cases:list', (s) => s.cases.list());
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <section className="screen">
      <div className="row between">
        <div className="column">
          <span className="eyebrow">FROM CONVERSATION TO CHANGE</span>
          <h2>Investigation cases</h2>
          <span className="small muted">Collect moments, add your reasoning, and build an evidence-backed finding.</span>
        </div>
        <button className="btn primary" type="button" onClick={() => dialog.current?.showModal()}>
          + New case
        </button>
      </div>
      <div className="trust-strip">
        <span className="status-dot" />
        {source.mode === 'fixtures' ? 'Fixture cases saved in this browser' : 'Saved to your workspace · shared only with people you name'}
        <span className="muted">Opening a case re-checks each source call against the reader’s own permissions</span>
      </div>
      <Async value={cases} label="Loading investigations…" skeleton="list">
        {(list) =>
          list.length === 0 ? (
            <Empty>
              No cases yet. <LinkBtn to={{ name: 'explore' }}>Find a conversation</LinkBtn> and save a moment to start investigating.
            </Empty>
          ) : (
            <div className="case-grid">
              {list.map((c) => (
                <article className="box case-card" key={c.id}>
                  <div className="row between">
                    <span className="tag">{c.shared ? `SHARED BY ${c.ownerEmail.split('@')[0].toUpperCase()}` : 'INVESTIGATION'}</span>
                    <span className="small muted">{fmtDate(c.updatedAt)}</span>
                  </div>
                  <h3>
                    <LinkBtn to={{ name: 'case', id: c.id }}>{c.title}</LinkBtn>
                  </h3>
                  <p className="muted small">{c.question || 'An open question, ready for evidence.'}</p>
                  <div className="row between">
                    <span className="small muted">
                      {c.excerptCount} excerpts · {c.noteCount} notes
                    </span>
                    <LinkBtn to={{ name: 'case', id: c.id }}>Open case →</LinkBtn>
                  </div>
                </article>
              ))}
            </div>
          )
        }
      </Async>
      <dialog className="dialog" ref={dialog}>
        <form
          className="column"
          style={{ gap: 16 }}
          onSubmit={(e) => void (async () => {
            e.preventDefault();
            setError('');
            try {
              const record = await source.cases.create(title.trim(), question.trim());
              dialog.current?.close();
              setTitle('');
              setQuestion('');
              void navigate(toPath({ name: 'case', id: record.id }));
            } catch (err) {
              setError(err instanceof Error ? err.message : 'The case could not be created.');
            }
          })()}
        >
          <span className="eyebrow">START AN INVESTIGATION</span>
          <h3>What are you looking into?</h3>
          <label>
            Case title
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example, repeat calls after a payment dispute" required maxLength={160} />
          </label>
          <label>
            Question (optional)
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} maxLength={4000} placeholder="What would change your mind?" />
          </label>
          {error ? (
            <p className="small warn" role="alert">
              {error}
            </p>
          ) : null}
          <div className="row">
            <button className="btn primary" type="submit" disabled={!title.trim()}>
              Create case
            </button>
            <button className="btn" type="button" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}

export function CaseDetail() {
  const { id = '' } = useParams();
  const record = useData(`case:${id}`, (s) => s.cases.get(id));
  return (
    <section className="screen">
      <div className="crumb">
        <LinkBtn to={{ name: 'cases' }}>← All cases</LinkBtn>
        <span> / Investigation</span>
      </div>
      <Async value={record} label="Loading investigation…">
        {(data) => <CaseBody key={data.id} record={data} onChange={record.set} />}
      </Async>
    </section>
  );
}

/** Play each saved clip in order: original audio when available, otherwise read the excerpt aloud. */
function useCasePlayback(record: Investigation) {
  const source = useSource();
  const audio = useRef<HTMLAudioElement | null>(null);
  const run = useRef(0);
  const [current, setCurrent] = useState<string | null>(null);
  const clips = record.items.filter((it) => it.type === 'clip' && it.interactionId);
  const stop = () => {
    run.current += 1;
    audio.current?.pause();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setCurrent(null);
  };
  useEffect(() => () => stop(), []);
  function playFrom(index: number, token: number) {
    const clip = clips[index];
    if (!clip || token !== run.current) return setCurrent(null);
    setCurrent(clip.id);
    const next = () => token === run.current && playFrom(index + 1, token);
    const url = source.audioUrl(clip.interactionId ?? '');
    if (url) {
      const el = (audio.current ??= new Audio());
      const start = clip.start ?? 0;
      const end = clip.end ?? start + 10;
      el.ontimeupdate = () => {
        if (el.currentTime >= end) {
          el.pause();
          next();
        }
      };
      el.onerror = next;
      const begin = () => {
        el.currentTime = start;
        el.play().catch(next);
      };
      if (el.src.endsWith(url)) begin();
      else {
        el.src = url;
        el.onloadedmetadata = begin;
      }
    } else if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(record.excerpts[clip.id]?.text || clip.note);
      utterance.lang = 'en-AU';
      utterance.onend = next;
      utterance.onerror = next;
      window.speechSynthesis.speak(utterance);
    } else next();
  }
  return {
    available: clips.length > 0,
    count: clips.length,
    current,
    position: current ? clips.findIndex((c) => c.id === current) + 1 : 0,
    play: () => {
      stop();
      playFrom(0, ++run.current);
    },
    stop,
  };
}

function CaseBody({ record, onChange }: { record: Investigation; onChange: (value: Investigation) => void }) {
  const source = useSource();
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(record.title);
  const [question, setQuestion] = useState(record.question);
  const [shareText, setShareText] = useState(record.sharedWith.join(', '));
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);
  const clips = record.items.filter((it) => it.type === 'clip');
  const notes = record.items.filter((it) => it.type === 'note');
  const context = record.items.filter((it) => it.type === 'theme' || it.type === 'label');
  const from = `/cases/${record.id}`;
  const playback = useCasePlayback(record);

  async function act(work: () => Promise<Investigation>, done: string) {
    setBusy(true);
    setMessage('');
    try {
      onChange(await work());
      setMessage(done);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'The change could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="row between">
        <div className="column">
          <span className="eyebrow">EVIDENCE WORKSPACE</span>
          {editing ? (
            <form
              className="column"
              style={{ gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                void act(() => source.cases.update(record.id, { title: title.trim(), question: question.trim(), version: record.version }), 'Case updated.').then(() => setEditing(false));
              }}
            >
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Case title" required maxLength={160} />
              <textarea value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Case question" rows={2} maxLength={4000} />
              <div className="row">
                <button className="btn primary" type="submit" disabled={busy}>
                  Save
                </button>
                <button className="btn" type="button" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <h2>
                {record.title}{' '}
                {record.canEdit ? (
                  <button className="link small edit-title" type="button" onClick={() => setEditing(true)}>
                    Edit
                  </button>
                ) : null}
              </h2>
              {record.question ? <p className="muted">{record.question}</p> : null}
            </>
          )}
          <span className="small muted">
            Owner {record.ownerEmail} · updated {fmtDate(record.updatedAt)}
            {record.canEdit ? '' : ' · read only'}
          </span>
        </div>
        <div className="row">
          <button
            className="btn"
            type="button"
            onClick={() => void (async () => {
              try {
                await navigator.clipboard.writeText(new URL(from, window.location.origin).href);
                setMessage(source.mode === 'fixtures' ? 'Link copied. Fixture cases only exist in this browser.' : 'Link copied. Only people you share with, who can also read the source calls, can open it.');
              } catch {
                setMessage('Clipboard unavailable. Copy the address bar instead.');
              }
            })()}
          >
            Copy link
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => void (async () => {
              try {
                setBrief((await source.cases.brief(record.id)).markdown);
              } catch (e) {
                setMessage(e instanceof Error ? e.message : 'Preview unavailable.');
              }
            })()}
          >
            Preview brief
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={() => void (async () => {
              try {
                const { filename, markdown } = await source.cases.brief(record.id);
                const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = filename;
                anchor.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                setMessage('Brief exported with source timestamps and its scope and limitations.');
              } catch (e) {
                setMessage(e instanceof Error ? e.message : 'The brief could not be exported.');
              }
            })()}
          >
            Export brief ↗
          </button>
        </div>
      </div>
      {message ? (
        <p className="small" role="status">
          {message}
        </p>
      ) : null}
      <div className="kpis">
        <Kpi label="Saved excerpts" value={String(clips.length)} delta="Timestamped transcript evidence" />
        <Kpi label="Conversations with evidence" value={String(new Set(clips.map((c) => c.interactionId)).size)} delta="Unique calls with saved excerpts" />
        <Kpi label="Analyst notes" value={String(notes.length + clips.length)} delta="Your interpretation alongside sources" />
        <Kpi label="Context items" value={String(context.length)} delta="Themes and label results, with scope" />
      </div>
      <div className="detail-grid cols">
        <div className="box">
          <div className="row between">
            <h3>Collected evidence</h3>
            <div className="row">
              {playback.available ? (
                <button className={`btn${playback.current ? '' : ' primary'}`} type="button" onClick={playback.current ? playback.stop : playback.play}>
                  {playback.current ? `■ Stop · clip ${playback.position} of ${playback.count}` : `▶ Play evidence (${playback.count})`}
                </button>
              ) : null}
              <LinkBtn to={{ name: 'explore' }}>+ Find more calls</LinkBtn>
            </div>
          </div>
          <p className="small muted">Open each source to inspect the surrounding conversation before drawing a conclusion.</p>
          {!clips.length && !context.length ? (
            <Empty>
              This case is ready for evidence. <LinkBtn to={{ name: 'explore' }}>Explore conversations →</LinkBtn>
            </Empty>
          ) : (
            <div className="column" style={{ gap: 16 }}>
              {record.items
                .filter((it) => it.type !== 'note')
                .map((it) =>
                  it.type === 'clip' ? (
                    <article className={`evidence-card${playback.current === it.id ? ' now-playing' : ''}`} key={it.id} aria-current={playback.current === it.id ? 'true' : undefined}>
                      <div className="row between">
                        <span className="eyebrow">EVIDENCE {String(clips.indexOf(it) + 1).padStart(2, '0')}</span>
                        {record.excerpts[it.id]?.queue ? <span className="tag">{record.excerpts[it.id].queue}</span> : null}
                      </div>
                      <h4>
                        <LinkBtn to={{ name: 'call', id: it.interactionId ?? '', t: it.start, from }}>
                          {it.interactionId} · {fmtTime(it.start ?? 0)}–{fmtTime(it.end ?? 0)} ↗
                        </LinkBtn>
                      </h4>
                      <blockquote className="quote">“{record.excerpts[it.id]?.text ?? ''}”</blockquote>
                      <p className="small">
                        <strong>Analyst note</strong>
                        <br />
                        {it.note}
                      </p>
                      <span className="small muted">
                        Saved by {it.createdBy} · {fmtDate(it.createdAt)}
                      </span>
                    </article>
                  ) : (
                    <article className="evidence-card" key={it.id}>
                      <span className="eyebrow">{it.type === 'theme' ? 'THEME CONTEXT' : 'LABEL RESULT'}</span>
                      <h4>
                        <LinkBtn to={it.type === 'theme' ? { name: 'theme', id: it.refId ?? '' } : { name: 'label', id: it.refId ?? '' }}>{it.title ?? it.refId}</LinkBtn>
                      </h4>
                      {it.scope ? <p className="small muted">Scope when saved: {it.scope}</p> : null}
                      <p className="small">{it.note}</p>
                      <span className="small muted">Totals reflect the scope when saved; reopen to see current figures.</span>
                    </article>
                  )
                )}
            </div>
          )}
        </div>
        <div className="column" style={{ gap: 16 }}>
          <div className="box">
            <h3>Analyst notebook</h3>
            <p className="small muted">Capture your hypothesis, counterexamples, and what you still need to verify.</p>
            {notes.map((it) => (
              <p key={it.id} className="quote small">
                {it.note}
              </p>
            ))}
            {record.canEdit ? (
              <form
                className="column"
                style={{ gap: 12 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(() => source.cases.addItem(record.id, { type: 'note', note: note.trim() }, record.version), 'Note added.').then(() => setNote(''));
                }}
              >
                <label className="sr-only" htmlFor="case-note">
                  Add an analyst note
                </label>
                <textarea id="case-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} required maxLength={4000} placeholder="What does the evidence suggest?" />
                <button className="btn" type="submit" disabled={busy || !note.trim()}>
                  Add note
                </button>
              </form>
            ) : null}
          </div>
          {record.canEdit && source.mode === 'live' ? (
            <div className="box">
              <h3>Share read-only</h3>
              <p className="small muted">Named colleagues can read this case. Each still needs their own access to every source call.</p>
              <form
                className="column"
                style={{ gap: 10 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const emails = shareText
                    .split(/[\s,;]+/)
                    .map((v) => v.trim())
                    .filter(Boolean);
                  void act(() => source.cases.share(record.id, emails, record.version), emails.length ? `Shared with ${emails.length} ${emails.length === 1 ? 'person' : 'people'}.` : 'Sharing removed.');
                }}
              >
                <label className="sr-only" htmlFor="share-emails">
                  Email addresses
                </label>
                <textarea id="share-emails" rows={2} value={shareText} onChange={(e) => setShareText(e.target.value)} placeholder="name@company.com, …" />
                <button className="btn" type="submit" disabled={busy}>
                  Update sharing
                </button>
              </form>
            </div>
          ) : null}
          <div className="box">
            <h3>Before you share a finding</h3>
            <ul className="list small">
              <li>Excerpts are a selected sample, not a measured population.</li>
              <li>Listen to each moment; transcripts can be wrong.</li>
              <li>Confirm outcomes using operational data.</li>
              <li>Exported briefs include these limitations.</li>
            </ul>
          </div>
        </div>
      </div>
      {brief != null ? (
        <details className="box" open>
          <summary>Exported brief preview</summary>
          <pre className="sql">{brief}</pre>
        </details>
      ) : null}
    </>
  );
}
