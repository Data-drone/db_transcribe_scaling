import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import type { DataError, Loaded } from '../data/source';
import { toPath, type Route } from '../router';
import { useWorkspace } from '../store';

export function LinkBtn({ to, children, className = 'link', state }: { to: Route | string; children: ReactNode; className?: string; state?: unknown }) {
  const { selection } = useWorkspace();
  return (
    <Link className={className} to={typeof to === 'string' ? to : toPath(to, selection)} state={state}>
      {children}
    </Link>
  );
}

export function Kpi({ label, value, delta, tone = 'neutral' }: { label: string; value: string; delta: string; tone?: 'good' | 'bad' | 'neutral' }) {
  return (
    <div className="kpi">
      <span className="muted small">{label}</span>
      <b>{value}</b>
      <span className={`small delta-${tone}`}>{delta}</span>
    </div>
  );
}

export function Bars({ items }: { items: { name: string; share: number; right?: string }[] }) {
  const max = Math.max(...items.map((i) => i.share), 0.01);
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
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ErrorNote({ error, retry }: { error: DataError; retry?: () => void }) {
  return (
    <div className="empty error-note" role="alert">
      <p>{error.status === 403 || error.status === 404 ? error.message : `Could not load this view. ${error.message}`}</p>
      {retry ? (
        <button className="btn" type="button" onClick={retry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

/** Render loaded data, a first-load spinner, or an error with retry. Keeps prior data while refreshing. */
export function Async<T>({ value, label, children }: { value: Loaded<T>; label?: string; children: (data: T) => ReactNode }) {
  if (value.error && value.data === undefined) return <ErrorNote error={value.error} retry={value.reload} />;
  if (value.data === undefined) return <Loading label={label} />;
  return (
    <div className={value.loading ? 'refreshing' : undefined} aria-busy={value.loading}>
      {value.error ? <ErrorNote error={value.error} retry={value.reload} /> : null}
      {children(value.data)}
    </div>
  );
}
