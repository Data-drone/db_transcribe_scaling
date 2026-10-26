import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { PERIODS, readSelection, scopeFor, rangeLabel, type ScopeSelection } from '../lib/scope';
import { useWorkspace } from '../store';

/** Keep the workspace scope in step with the page URL (period + queue). */
export function useUrlScope() {
  const [params] = useSearchParams();
  const { selection, setSelection, bounds } = useWorkspace();
  const fromUrl = useMemo(() => readSelection(params, selection), [params, selection]);
  useEffect(() => setSelection(fromUrl), [fromUrl, setSelection]);
  return { selection: fromUrl, scope: scopeFor(fromUrl, bounds.data) };
}

export function Filters({ onChange }: { onChange?: (selection: ScopeSelection) => void }) {
  const [params, setParams] = useSearchParams();
  const { bounds } = useWorkspace();
  const { selection } = useUrlScope();
  function update(patch: Partial<ScopeSelection>) {
    const next = { ...selection, ...patch };
    const updated = new URLSearchParams(params);
    updated.set('period', next.period);
    updated.set('queue', next.queue || 'all');
    updated.delete('page');
    setParams(updated, { replace: true });
    onChange?.(next);
  }
  const queues = bounds.data?.queues ?? [];
  return (
    <div className="row filters">
      <label>
        Period{bounds.data?.maxDate ? ` · data to ${rangeLabel(bounds.data.maxDate, bounds.data.maxDate)}` : ''}
        <select className="select" value={selection.period} onChange={(e) => update({ period: e.target.value as ScopeSelection['period'] })}>
          {PERIODS.map((p) => {
            const scope = scopeFor({ ...selection, period: p.value }, bounds.data);
            return (
              <option key={p.value} value={p.value}>
                {p.label}
                {scope.start ? ` · ${rangeLabel(scope.start, scope.end)}` : ''}
              </option>
            );
          })}
        </select>
      </label>
      <label>
        Queue
        <select className="select" value={selection.queue || 'all'} onChange={(e) => update({ queue: e.target.value === 'all' ? '' : e.target.value })}>
          <option value="all">All queues</option>
          {selection.queue && !queues.includes(selection.queue) ? <option value={selection.queue}>{selection.queue}</option> : null}
          {queues.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
