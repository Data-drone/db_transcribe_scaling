import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useGenieChat, type GenieMessageItem } from '@databricks/appkit-ui/react';
import { LinkBtn } from '../components/ui';
import { useSource } from '../data/source';
import { STARTER_QUESTIONS, answerQuestion } from '../data/fixtures/data';

const LIVE_QUESTIONS = [
  'How many calls are available in each queue, and which recording dates do they cover?',
  'Which contact reasons have the longest average call duration? Show enrichment coverage.',
  'Show five calls with negative closing sentiment and their interaction IDs.',
  'Which calls mention repeat contact? Include the interaction IDs so I can review the evidence.',
];

export function Ask() {
  const source = useSource();
  return source.mode === 'live' ? <LiveAsk /> : <FixtureAsk />;
}

function Heading({ note }: { note: string }) {
  return (
    <div className="column">
      <span className="eyebrow">INTELLIGENCE / ASK</span>
      <h2>Ask your conversations</h2>
      <span className="small muted">{note}</span>
    </div>
  );
}

function LiveAsk() {
  const [params] = useSearchParams();
  const [question, setQuestion] = useState(params.get('q') ?? '');
  const { messages, status, error, sendMessage, reset } = useGenieChat({ alias: 'default' });
  const busy = status === 'streaming' || status === 'loading-history';
  function ask(text: string) {
    if (!text.trim() || busy) return;
    sendMessage(text.trim());
    setQuestion('');
  }
  return (
    <section className="screen">
      <div className="row between">
        <Heading note="Questions run as governed SQL over curated, masked call views with your own Databricks permissions. Follow each answer back to its calls." />
        <button className="btn" type="button" onClick={reset}>
          New conversation
        </button>
      </div>
      {!messages.length ? (
        <div className="box">
          <h3>Start with a question</h3>
          <ul className="list">
            {LIVE_QUESTIONS.map((text) => (
              <li key={text}>
                <button className="link" type="button" disabled={busy} onClick={() => ask(text)}>
                  {text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="column" style={{ gap: 12 }} aria-live="polite">
        {messages.map((message) => (
          <Answer key={message.id} message={message} />
        ))}
      </div>
      {busy ? (
        <p role="status" className="small muted">
          {status === 'loading-history' ? 'Loading conversation…' : 'Genie is analysing data and running its query…'}
        </p>
      ) : null}
      {status === 'error' ? (
        <p className="small warn" role="alert">
          Genie could not complete this question. {error ?? 'Try rephrasing it or start a new conversation.'}
        </p>
      ) : null}
      <form
        className="ask"
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
      >
        <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about queues, patterns, sentiment or individual calls…" aria-label="Question" />
        <button className="btn primary" type="submit" disabled={busy || !question.trim()}>
          Ask
        </button>
      </form>
      <p className="data-footnote">AI-generated from call data. Check the SQL, coverage and linked conversations before drawing a conclusion.</p>
    </section>
  );
}

function Answer({ message }: { message: GenieMessageItem }) {
  if (message.role === 'user') return <div className="ask-question">{message.content}</div>;
  return (
    <div className="box">
      <span className="tag">Genie answer</span>
      {message.content ? <p style={{ whiteSpace: 'pre-wrap' }}>{message.content}</p> : null}
      {message.error ? <p className="small warn">{message.error}</p> : null}
      {message.attachments.map((attachment, index) => (
        <div key={attachment.attachmentId ?? index} className="column" style={{ gap: 8 }}>
          {attachment.text?.content && attachment.text.content !== message.content ? <p style={{ whiteSpace: 'pre-wrap' }}>{attachment.text.content}</p> : null}
          {attachment.query ? (
            <details>
              <summary>Show the SQL · {attachment.query.title ?? 'How this answer was computed'}</summary>
              <pre className="sql">{attachment.query.query ?? 'SQL not supplied by Genie.'}</pre>
            </details>
          ) : null}
        </div>
      ))}
      {[...message.queryResults.entries()].map(([id, result]) => {
        const columns = result.manifest?.schema?.columns ?? [];
        const rows = result.result?.data_array ?? [];
        const timeColumn = columns.findIndex((c) => ['start_seconds', 'evidence_start_seconds'].includes(c.name.toLowerCase()));
        return rows.length ? (
          <div key={id} className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.name}>{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c}>
                        {columns[c]?.name.toLowerCase() === 'interaction_id' && cell ? (
                          <LinkBtn
                            to={{
                              name: 'call',
                              id: String(cell),
                              from: '/ask',
                              t: timeColumn >= 0 && Number.isFinite(Number(row[timeColumn])) && Number(row[timeColumn]) >= 0 ? Number(row[timeColumn]) : undefined,
                            }}
                          >
                            {String(cell)}
                          </LinkBtn>
                        ) : (
                          (cell ?? '—')
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 100 ? <p className="small muted">Showing the first 100 of {rows.length} rows.</p> : null}
          </div>
        ) : (
          <p key={id} className="small muted">
            No rows matched this question.
          </p>
        );
      })}
    </div>
  );
}

function FixtureAsk() {
  const [params, setParams] = useSearchParams();
  const initial = params.get('q') ?? '';
  const [q, setQ] = useState(initial);
  const answer = useMemo(() => (initial ? answerQuestion(initial) : null), [initial]);
  function submit(text: string) {
    if (!text.trim()) return;
    setQ(text.trim());
    setParams({ q: text.trim() });
  }
  return (
    <section className="screen">
      <Heading note="Fixture mode: answers, SQL and result tables are predefined examples. Switch to live data to ask the Genie space." />
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about queues, themes, labels…" aria-label="Question" />
        <button className="btn primary" type="submit">
          Preview answer
        </button>
      </form>
      {!answer ? (
        <div className="box">
          <h3>Starter questions</h3>
          <ul className="list">
            {STARTER_QUESTIONS.map((s) => (
              <li key={s}>
                <button className="link" type="button" onClick={() => submit(s)}>
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="column" style={{ gap: 12 }}>
          <div className="box">
            <span className="tag">Simulated answer</span>
            <h3>{answer.question}</h3>
            <p>{answer.prose}</p>
          </div>
          <div className="box">
            <h3>Illustrative SQL</h3>
            <pre className="sql">{answer.sql}</pre>
          </div>
          <div className="box table-scroll">
            <table className="data">
              <thead>
                <tr>
                  {answer.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {answer.rows.map((r, i) => (
                  <tr key={i}>
                    {r.cells.map((cell, j) => (
                      <td key={j}>{j === 0 && r.href ? <FixtureLink href={r.href}>{cell}</FixtureLink> : cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function FixtureLink({ href, children }: { href: string; children: string }) {
  const parts = href.replace('#', '').split('/').filter(Boolean);
  if (parts[0] === 'themes' && parts[1]) return <LinkBtn to={{ name: 'theme', id: parts[1] }}>{children}</LinkBtn>;
  if (parts[0] === 'labels' && parts[1]) return <LinkBtn to={{ name: 'label', id: parts[1] }}>{children}</LinkBtn>;
  if (parts[0] === 'calls' && parts[1]) return <LinkBtn to={{ name: 'call', id: parts[1], from: '/ask' }}>{children}</LinkBtn>;
  return <>{children}</>;
}
