import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { DataError, Loaded } from '../data/source';
import { toPath, type Route } from '../router';
import { useWorkspace } from '../store';

export function LinkBtn({ to, children, className = 'link', state }: { to: Route | string; children: ReactNode; className?: string; state?: unknown }) {
  const { selection } = useWorkspace();
  return (
    <Link className={className} to={typeof to === 'string' ? to : toPath(to, selection)} state={state} viewTransition>
      {children}
    </Link>
  );
}

export function Kpi({ label, value, delta, tone = 'neutral' }: { label: string; value: ReactNode; delta: string; tone?: 'good' | 'bad' | 'neutral' }) {
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

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Animate a number from its previous value. Instant when the viewer prefers reduced motion. */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString(), duration = 450 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || reducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    let frame = 0;
    const began = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(start + (value - start) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      from.current = value;
    };
  }, [value, duration]);
  return <span className="tabular">{format(shown)}</span>;
}

/** Placeholder shapes that match the layout being loaded, so the page doesn't jump. */
export function Skeleton({ kind }: { kind: 'overview' | 'list' | 'detail' }) {
  return (
    <div className="skeleton" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {kind === 'overview' ? (
        <>
          <div className="sk-row">
            {[0, 1, 2, 3].map((i) => (
              <i key={i} className="sk-block" style={{ height: 120 }} />
            ))}
          </div>
          <div className="sk-row sk-two">
            <i className="sk-block" style={{ height: 270 }} />
            <i className="sk-block" style={{ height: 270 }} />
          </div>
        </>
      ) : kind === 'detail' ? (
        <>
          <i className="sk-block" style={{ height: 220 }} />
          <div className="sk-row sk-two">
            <i className="sk-block" style={{ height: 420 }} />
            <i className="sk-block" style={{ height: 420 }} />
          </div>
        </>
      ) : (
        [0, 1, 2, 3, 4].map((i) => <i key={i} className="sk-block" style={{ height: 64 }} />)
      )}
    </div>
  );
}

/** Render loaded data, a first-load skeleton or spinner, or an error with retry. Keeps prior data while refreshing. */
export function Async<T>({ value, label, skeleton, children }: { value: Loaded<T>; label?: string; skeleton?: 'overview' | 'list' | 'detail'; children: (data: T) => ReactNode }) {
  if (value.error && value.data === undefined) return <ErrorNote error={value.error} retry={value.reload} />;
  if (value.data === undefined) return skeleton ? <Skeleton kind={skeleton} /> : <Loading label={label} />;
  return (
    <div className={`async${value.loading ? ' refreshing' : ''}`} aria-busy={value.loading}>
      {value.error ? <ErrorNote error={value.error} retry={value.reload} /> : null}
      {children(value.data)}
    </div>
  );
}
