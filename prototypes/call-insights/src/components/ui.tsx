import type { CSSProperties, ReactNode } from 'react'
import { go, toHash } from '../router'
import type { Route } from '../types'

export function LinkBtn({ to, children, className = 'link' }: { to: Route; children: ReactNode; className?: string }) {
  return (
    <a
      className={className}
      href={toHash(to)}
      onClick={(e) => {
        e.preventDefault()
        go(to)
      }}
    >
      {children}
    </a>
  )
}

export function Kpi({
  label,
  value,
  delta,
  tone = 'neutral',
}: {
  label: string
  value: string
  delta: string
  tone?: 'good' | 'bad' | 'neutral'
}) {
  return (
    <div className="kpi">
      <span className="muted small">{label}</span>
      <b>{value}</b>
      <span className={`small delta-${tone}`}>{delta}</span>
    </div>
  )
}

export function Bars({ items }: { items: { name: string; share: number; right?: string }[] }) {
  const max = Math.max(...items.map((i) => i.share), 0.01)
  return (
    <div className="bars">
      {items.map((i) => (
        <div className="bar" key={i.name}>
          <span>{i.name}</span>
          <i style={{ '--w': `${(i.share / max) * 100}%` } as CSSProperties} />
          <span>{i.right ?? `${Math.round(i.share * 100)}%`}</span>
        </div>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}
