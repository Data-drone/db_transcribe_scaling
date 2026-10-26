import { useMemo, useState } from 'react'
import { LinkBtn } from '../components/ui'
import { STARTER_QUESTIONS, answerQuestion } from '../data'
import { go } from '../router'
import type { Route } from '../types'

export function Ask({ initial }: { initial?: string }) {
  const [q, setQ] = useState(initial ?? '')
  const [asked, setAsked] = useState(initial ?? '')
  const answer = useMemo(() => (asked ? answerQuestion(asked) : null), [asked])

  function submit(next: string) {
    const text = next.trim()
    if (!text) return
    setQ(text)
    setAsked(text)
    go({ name: 'ask', q: text })
  }

  return (
    <section className="screen">
      <div className="column">
        <span className="tag">Simulated answers</span>
        <h2>Ask</h2>
        <span className="small muted">
          Explore the proposed question-and-answer experience. Responses, SQL and result tables are predefined demo fixtures; no model, Genie space or warehouse query runs here.
        </span>
      </div>
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault()
          submit(q)
        }}
      >
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about queues, themes, labels…" aria-label="Question" />
        <button className="btn primary" type="submit">Preview answer</button>
      </form>

      {!answer ? (
        <div className="box">
          <h3>Starter questions</h3>
          <ul className="list">
            {STARTER_QUESTIONS.map((s) => (
              <li key={s}>
                <button className="link" onClick={() => submit(s)}>{s}</button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="column" style={{ gap: 12 }}>
          <div className="box">
            <h3>{answer.question}</h3>
            <p>{answer.prose}</p>
            <span className="small muted">Simulated AI answer · Illustrative scenario figures are independent of the selected demo cohort. Verify a real answer against executed SQL and authorized source calls.</span>
          </div>
          <div className="box">
            <h3>Illustrative SQL</h3>
            <pre className="sql">{answer.sql}</pre>
          </div>
          <div className="box">
            <h3>Result</h3>
            <table className="data">
              <thead>
                <tr>{answer.columns.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {answer.rows.map((r, i) => (
                  <tr key={i}>
                    {r.cells.map((cell, j) => (
                      <td key={j}>
                        {j === 0 && r.href ? <ResultLink href={r.href}>{cell}</ResultLink> : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

function ResultLink({ href, children }: { href: string; children: string }) {
  const route = hrefToRoute(href)
  if (!route) return <a className="link" href={href}>{children}</a>
  return <LinkBtn to={route}>{children}</LinkBtn>
}

function hrefToRoute(href: string): Route | null {
  const path = href.replace('#', '')
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'themes' && parts[1]) return { name: 'theme', id: parts[1] }
  if (parts[0] === 'labels' && parts[1]) return { name: 'label', id: parts[1] }
  if (parts[0] === 'calls' && parts[1]) return { name: 'call', id: parts[1] }
  return null
}
