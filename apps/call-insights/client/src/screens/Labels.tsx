import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { LabelTracking } from '../../../shared/insights';
import type { IntelligenceLabel, LabelInput, LabelRun, RunEstimate } from '../../../shared/intelligence';
import { Async, Bars, Empty, Kpi, LinkBtn, Loading } from '../components/ui';
import { useData, useSource } from '../data/source';
import { fmtDate, fmtTime, pct } from '../lib/format';
import { fmtDay } from '../lib/scope';
import { toPath } from '../router';
import { useWorkspace } from '../store';

export function Labels() {
  const labels = useData('labels:list', (s) => s.labels.list());
  const summary = useData('labels:summary', (s) => s.labels.summary());
  const [q, setQ] = useState('');
  return (
    <section className="screen">
      <div className="row between">
        <div className="column">
          <span className="eyebrow">PROVE IT</span>
          <h2>Labels</h2>
          <span className="small muted">Describe a pattern in plain English, test it on a sample, review the matches, then run it across calls and track it.</span>
        </div>
        <div className="row">
          <input className="input" style={{ width: 200 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search labels" aria-label="Search labels" />
          <LinkBtn className="btn primary" to={{ name: 'label', id: 'new' }}>
            New label
          </LinkBtn>
        </div>
      </div>
      <Async value={labels} label="Loading labels…">
        {(list) => {
          const shown = list.filter((l) => {
            const current = l.versions.find((v) => v.version === l.currentVersion) ?? l.versions.at(-1);
            const text = `${current?.name ?? ''} ${current?.definition ?? ''}`.toLowerCase();
            return text.includes(q.toLowerCase());
          });
          if (!shown.length) return <Empty>{list.length ? 'No labels match.' : 'No labels yet. Start one from Explore, a theme, or New label.'}</Empty>;
          return (
            <div className="box">
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Version</th>
                    <th>Latest run</th>
                    <th>Matched</th>
                    <th>Reviewer agreement</th>
                    <th>Tracked</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((l) => {
                    const current = l.versions.find((v) => v.version === l.currentVersion) ?? l.versions.at(-1);
                    const latest = summary.data?.latest.find((r) => r.label_id === l.id);
                    const tracked = summary.data?.tracking.find((t) => t.label_id === l.id);
                    const enabled = tracked?.enabled === true || tracked?.enabled === 'true';
                    return (
                      <tr key={l.id}>
                        <td>
                          <LinkBtn to={{ name: 'label', id: l.id }}>{current?.name ?? l.id}</LinkBtn>
                          <span className="small muted cell-secondary">{current?.queue || 'All queues'}</span>
                        </td>
                        <td className="mono">v{l.currentVersion}</td>
                        <td>{latest ? `${latest.run_type} · ${latest.status} · ${fmtDate(latest.started_at)}` : 'Not run'}</td>
                        <td className="mono">{latest ? `${latest.matched_count} / ${latest.interactions_in_scope}` : '—'}</td>
                        <td className="mono">{latest?.reviewed_count ? `${latest.correct_count} of ${latest.reviewed_count}` : '—'}</td>
                        <td>{enabled ? `Yes · v${tracked?.version}` : 'No'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }}
      </Async>
    </section>
  );
}

export function LabelBuilder() {
  const { id = 'new' } = useParams();
  const label = useData(`label:${id}`, async (s) => (id === 'new' ? null : ((await s.labels.list()).find((l) => l.id === id) ?? Promise.reject(new Error('Label not found.')))));
  return (
    <section className="screen">
      <div className="crumb">
        <LinkBtn to={{ name: 'labels' }}>Labels</LinkBtn> / Builder
      </div>
      <Async value={label} label="Loading label…">
        {(data) => <Builder key={data?.id ?? 'new'} label={data} onSaved={label.set} />}
      </Async>
    </section>
  );
}

const ACTIVE = ['pending', 'running'];

function Builder({ label, onSaved }: { label: IntelligenceLabel | null; onSaved: (label: IntelligenceLabel) => void }) {
  const source = useSource();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { bounds } = useWorkspace();
  const current = label?.versions.find((v) => v.version === label.currentVersion) ?? label?.versions.at(-1);
  const [form, setForm] = useState<LabelInput>(() =>
    current
      ? { name: current.name, definition: current.definition, includeExamples: current.includeExamples, excludeExamples: current.excludeExamples, speakerFocus: current.speakerFocus, queue: current.queue, startDate: current.startDate, endDate: current.endDate }
      : {
          name: params.get('name') ?? '',
          definition: params.get('definition') ?? '',
          includeExamples: '',
          excludeExamples: '',
          speakerFocus: 'any',
          queue: params.get('queue') ?? '',
          startDate: params.get('start') || '1900-01-01',
          endDate: params.get('end') || '9999-12-31',
        }
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [estimate, setEstimate] = useState<RunEstimate | null>(null);
  const [nonce, setNonce] = useState(0);
  const runs = useData(`label:${label?.id}:runs:${nonce}`, (s) => (label ? s.labels.runs(label.id) : Promise.resolve([] as LabelRun[])));
  const tracking = useData(`label:${label?.id}:tracking:${nonce}`, (s) => (label ? s.labels.tracking(label.id) : Promise.resolve(null)));
  const dirty = !current || JSON.stringify({ ...current, version: 0, createdAt: '', promptHash: '' }) !== JSON.stringify({ ...form, version: 0, createdAt: '', promptHash: '' });
  const versionRuns = (runs.data ?? []).filter((r) => r.version === label?.currentVersion);
  const running = versionRuns.some((r) => ACTIVE.includes(r.status));
  const sampleDone = versionRuns.some((r) => r.run_type === 'sample' && r.status === 'completed' && r.error_count === 0);
  const fullDone = versionRuns.some((r) => r.run_type === 'full' && r.status === 'completed');
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const shownRun = useMemo(() => {
    const list = runs.data ?? [];
    return list.find((r) => r.run_id === selectedRun) ?? versionRuns.find((r) => r.run_type === 'full') ?? versionRuns[0] ?? list[0] ?? null;
  }, [runs.data, selectedRun, versionRuns]);

  // Poll while the worker is evaluating a run.
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setNonce((n) => n + 1), 4000);
    return () => clearTimeout(timer);
  }, [running, runs.data]);

  async function act(name: string, work: () => Promise<void>) {
    setBusy(name);
    setMessage('');
    try {
      await work();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'The request failed.');
    } finally {
      setBusy(null);
    }
  }
  const save = () =>
    act('save', async () => {
      const saved = label ? await source.labels.update(label.id, form) : await source.labels.create(form);
      onSaved(saved);
      setMessage(label ? `Saved as version ${saved.currentVersion}. Earlier results keep their original version.` : 'Label created.');
      if (!label) void navigate(toPath({ name: 'label', id: saved.id }), { replace: true });
    });

  const set = (patch: Partial<LabelInput>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <>
      <div className="row between">
        <div className="column">
          <span className="eyebrow">LABEL BUILDER</span>
          <h2>{form.name || 'New label'}</h2>
          <span className="small muted">
            {label ? `Version ${label.currentVersion}${dirty ? ' · unsaved changes create a new version' : ''}` : 'Draft · not saved'}
          </span>
        </div>
        {label ? <TrackingToggle labelId={label.id} version={label.currentVersion} tracking={tracking.data ?? null} fullDone={fullDone} onChange={(t) => tracking.set(t)} /> : null}
      </div>
      {source.mode === 'fixtures' ? <p className="scope-strip">Fixture mode · sample and full runs are simulated from fictional calls; no model is called.</p> : null}
      {message ? (
        <p className="small" role="status">
          {message}
        </p>
      ) : null}
      <div className="cols cols-even">
        <form
          className="box column"
          style={{ gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            Label name
            <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} required maxLength={120} />
          </label>
          <label>
            Describe what to look for
            <textarea value={form.definition} onChange={(e) => set({ definition: e.target.value })} required minLength={10} maxLength={6000} rows={4} />
          </label>
          <label>
            Examples that should match
            <textarea value={form.includeExamples} onChange={(e) => set({ includeExamples: e.target.value })} maxLength={2000} rows={2} />
          </label>
          <label>
            Examples that should not match
            <textarea value={form.excludeExamples} onChange={(e) => set({ excludeExamples: e.target.value })} maxLength={2000} rows={2} />
          </label>
          <div className="row">
            <label>
              Speaker focus
              <select className="select" value={form.speakerFocus} onChange={(e) => set({ speakerFocus: e.target.value as LabelInput['speakerFocus'] })}>
                <option value="any">Any</option>
                <option value="customer">Customer</option>
                <option value="agent">Agent</option>
              </select>
            </label>
            <label>
              Queue
              <select className="select" value={form.queue} onChange={(e) => set({ queue: e.target.value })}>
                <option value="">All queues</option>
                {(bounds.data?.queues ?? []).map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row">
            <label>
              From
              <input className="input" type="date" value={form.startDate === '1900-01-01' ? '' : form.startDate} onChange={(e) => set({ startDate: e.target.value || '1900-01-01' })} />
            </label>
            <label>
              To
              <input className="input" type="date" value={form.endDate === '9999-12-31' ? '' : form.endDate} onChange={(e) => set({ endDate: e.target.value || '9999-12-31' })} />
            </label>
          </div>
          <div className="row">
            <button className="btn" type="submit" disabled={busy !== null || !dirty || form.definition.trim().length < 10 || !form.name.trim()}>
              {busy === 'save' ? 'Saving…' : label ? 'Save new version' : 'Create label'}
            </button>
            <button
              className="btn"
              type="button"
              disabled={!label || dirty || busy !== null || running}
              onClick={() =>
                void act('sample', async () => {
                  const run = await source.labels.sample(label!.id, label!.currentVersion);
                  setSelectedRun(run.runId);
                  setMessage(`Sample test started on ${run.count} calls. Results appear as the worker finishes.`);
                  setNonce((n) => n + 1);
                })
              }
            >
              {busy === 'sample' ? 'Starting…' : 'Test on 20 calls'}
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={!label || dirty || !sampleDone || busy !== null || running}
              onClick={() => void act('estimate', async () => setEstimate(await source.labels.estimate(label!.id, label!.currentVersion)))}
            >
              {busy === 'estimate' ? 'Estimating…' : 'Run on all calls…'}
            </button>
          </div>
          <p className="small muted">
            {!label
              ? 'Create the label, then test it on a sample.'
              : dirty
                ? 'Save these changes as a new version before testing.'
                : sampleDone
                  ? 'Sample complete. Review the matches, then run on all calls in scope.'
                  : 'A full run needs a successful sample test on this version first.'}
          </p>
        </form>
        <div className="box">
          <h3>Results</h3>
          <Async value={runs} label="Loading runs…">
            {(list) =>
              !list.length ? (
                <Empty>No runs yet. Test the label on a sample to see matches and non-matches.</Empty>
              ) : (
                <>
                  <label className="small">
                    Run
                    <select className="select" value={shownRun?.run_id ?? ''} onChange={(e) => setSelectedRun(e.target.value)}>
                      {list.map((r) => (
                        <option key={r.run_id} value={r.run_id}>
                          v{r.version} · {r.run_type} · {r.status} · {fmtDate(r.started_at)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {shownRun ? <RunSummary run={shownRun} /> : null}
                </>
              )
            }
          </Async>
          {tracking.data?.enabled ? <TrackingTrend tracking={tracking.data} /> : null}
        </div>
      </div>
      {shownRun && !ACTIVE.includes(shownRun.status) ? <RunResults run={shownRun} labelName={form.name} labelId={label?.id ?? ''} /> : null}
      {estimate && label ? (
        <ConfirmRun
          estimate={estimate}
          onCancel={() => setEstimate(null)}
          onConfirm={() =>
            void act('full', async () => {
              const run = await source.labels.full(label.id, label.currentVersion, estimate.cohortId);
              setEstimate(null);
              setSelectedRun(run.runId);
              setMessage(`Full run started on ${run.count.toLocaleString()} calls.`);
              setNonce((n) => n + 1);
            })
          }
        />
      ) : null}
    </>
  );
}

function RunSummary({ run }: { run: LabelRun }) {
  const evaluated = run.processed_count - run.error_count;
  return (
    <>
      {ACTIVE.includes(run.status) ? <Loading label={`Evaluating · ${run.processed_count} of ${run.interactions_in_scope} processed`} /> : null}
      <div className="kpis">
        <Kpi label="Calls matched" value={evaluated ? pct(run.matched_count / evaluated) : '—'} delta={`${run.matched_count.toLocaleString()} of ${evaluated.toLocaleString()} evaluated`} />
        <Kpi label="Errors / ungrounded" value={`${run.error_count} / ${run.ungrounded_count}`} delta="Errors are not counted as non-matches" tone={run.error_count || run.ungrounded_count ? 'bad' : 'neutral'} />
      </div>
      {run.error_message ? <p className="small warn">{run.error_message}</p> : null}
      <p className="small muted">
        {run.model_endpoint} · {run.run_type} run of {run.interactions_in_scope.toLocaleString()} calls
      </p>
    </>
  );
}

function RunResults({ run, labelName, labelId }: { run: LabelRun; labelName: string; labelId: string }) {
  const source = useSource();
  const [page, setPage] = useState(0);
  const results = useData(`run:${run.run_id}:${run.status}:${run.processed_count}:${page}`, (s) => s.labels.results(run.run_id, page));
  const [saved, setSaved] = useState('');
  const from = `/labels/${encodeURIComponent(labelId)}`;
  async function verdict(interactionId: string, value: 'correct' | 'incorrect') {
    await source.labels.feedback(run.run_id, interactionId, value);
    if (results.data) results.set({ ...results.data, results: results.data.results.map((r) => (r.interaction_id === interactionId ? { ...r, verdict: value } : r)) });
  }
  async function saveToCase() {
    try {
      const list = await source.cases.list();
      const own = list.find((c) => !c.shared);
      const record = own ? await source.cases.get(own.id) : await source.cases.create(`Investigating: ${labelName}`);
      await source.cases.addItem(
        record.id,
        {
          type: 'label',
          refId: labelId,
          title: `${labelName} · v${run.version}`,
          scope: `${run.run_type} run of ${run.interactions_in_scope} calls, ${fmtDate(run.started_at)}`,
          note: `${run.matched_count} of ${run.processed_count - run.error_count} evaluated calls matched (${run.error_count} errors, ${run.ungrounded_count} ungrounded). AI classification; reviewer agreement shown in the label.`,
        },
        record.version
      );
      setSaved(record.id);
    } catch (e) {
      setSaved('');
      alert(e instanceof Error ? e.message : 'Could not save to a case.');
    }
  }
  return (
    <Async value={results} label="Loading results…">
      {(data) => {
        const reviewed = data.results.filter((r) => r.verdict);
        const queues = data.breakdown.filter((b) => b.dimension === 'queue');
        return (
          <>
            <div className="cols cols-even">
              <div className="box">
                <h3>Prevalence by queue</h3>
                <Bars items={queues.map((q) => ({ name: q.value, share: q.evaluated_count ? q.matched_count / q.evaluated_count : 0, right: `${q.matched_count}/${q.evaluated_count}` }))} />
              </div>
              <div className="box">
                <h3>Reviewer agreement</h3>
                <p className="big-number">{reviewed.length ? `${reviewed.filter((r) => r.verdict === 'correct').length} of ${reviewed.length}` : '—'}</p>
                <p className="small muted">Your verdicts on this page of results. Review matches and non-matches before running on all calls.</p>
                <button className="btn" type="button" disabled={Boolean(saved)} onClick={() => void saveToCase()}>
                  {saved ? 'Saved to case' : 'Save result to case'}
                </button>
                {saved ? (
                  <p className="small">
                    <LinkBtn to={{ name: 'case', id: saved }}>Open case →</LinkBtn>
                  </p>
                ) : null}
              </div>
            </div>
            <div className="box">
              <div className="row between">
                <h3>Matches and non-matches</h3>
                <div className="row">
                  <button className="btn" type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    ← Previous
                  </button>
                  <span className="small">Page {page + 1}</span>
                  <button className="btn" type="button" disabled={data.results.length < data.pageSize} onClick={() => setPage((p) => p + 1)}>
                    Next →
                  </button>
                </div>
              </div>
              {!data.results.length ? (
                <Empty>No results on this page.</Empty>
              ) : (
                <ul className="list">
                  {data.results.map((r) => (
                    <li key={r.interaction_id}>
                      <div className="row between">
                        <LinkBtn to={{ name: 'call', id: r.interaction_id, from, t: r.evidence_start_seconds >= 0 ? r.evidence_start_seconds : undefined }}>
                          {r.interaction_id} · {r.error_message ? 'error' : r.matched ? 'match' : 'non-match'}
                          {r.evidence_start_seconds >= 0 ? ` · ${fmtTime(r.evidence_start_seconds)}` : ''} · {r.confidence || '—'} · {r.queue}
                        </LinkBtn>
                        {!r.error_message ? (
                          <div className="row" role="group" aria-label={`Is ${r.interaction_id} classified correctly?`}>
                            <span className="small muted">Correct?</span>
                            <button className="btn" type="button" aria-pressed={r.verdict === 'correct'} onClick={() => void verdict(r.interaction_id, 'correct')}>
                              Yes
                            </button>
                            <button className="btn" type="button" aria-pressed={r.verdict === 'incorrect'} onClick={() => void verdict(r.interaction_id, 'incorrect')}>
                              No
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {r.evidence_quote ? <div className="quote small">“{r.evidence_quote}”</div> : null}
                      <span className="small muted">
                        {r.error_message || r.reason}
                        {r.matched && !r.grounded ? ' · quote not found in the transcript (ungrounded)' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        );
      }}
    </Async>
  );
}

function TrackingToggle({ labelId, version, tracking, fullDone, onChange }: { labelId: string; version: number; tracking: LabelTracking | null; fullDone: boolean; onChange: (t: LabelTracking) => void }) {
  const source = useSource();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const enabled = Boolean(tracking?.enabled);
  const stale = enabled && tracking?.version !== version;
  return (
    <div className="column" style={{ alignItems: 'flex-end', gap: 4 }}>
      <button
        className={`btn${enabled && !stale ? '' : ' primary'}`}
        type="button"
        disabled={busy || (!enabled && !fullDone) || (stale && !fullDone)}
        onClick={() => void (async () => {
          setBusy(true);
          setError('');
          try {
            onChange(await source.labels.setTracking(labelId, version, stale ? true : !enabled));
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Tracking could not be changed.');
          } finally {
            setBusy(false);
          }
        })()}
      >
        {busy ? 'Saving…' : stale ? `Track v${version} instead` : enabled ? 'Stop tracking' : 'Track over time'}
      </button>
      <span className="small muted">
        {enabled
          ? `Tracking v${tracking?.version} since ${tracking?.enabledAt ? fmtDate(tracking.enabledAt) : '—'}${tracking?.lastRunAt ? ` · last checked ${fmtDate(tracking.lastRunAt)}` : ''}`
          : fullDone
            ? 'New calls are evaluated daily once tracked.'
            : 'Needs a full run on this version first.'}
      </span>
      {error ? (
        <span className="small warn" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function TrackingTrend({ tracking }: { tracking: LabelTracking }) {
  const max = Math.max(...tracking.points.map((p) => (p.evaluated ? p.matched / p.evaluated : 0)), 0.01);
  return (
    <div style={{ marginTop: 16 }}>
      <h3>Tracked prevalence</h3>
      {tracking.points.length ? (
        <div className="mini-trend" role="img" aria-label="Share of evaluated calls matching this label per recording day">
          {tracking.points.map((p) => (
            <span key={p.date} title={`${fmtDay(p.date)}: ${p.matched} of ${p.evaluated}`}>
              <i style={{ height: `${((p.evaluated ? p.matched / p.evaluated : 0) / max) * 100}%` }} />
              <small>{fmtDay(p.date, false)}</small>
            </span>
          ))}
        </div>
      ) : (
        <p className="small muted">No evaluated calls yet.</p>
      )}
      <p className="small muted">Share of evaluated calls matching, per recording day, from the full run plus daily tracking runs.</p>
    </div>
  );
}

function ConfirmRun({ estimate, onCancel, onConfirm }: { estimate: RunEstimate; onCancel: () => void; onConfirm: () => void }) {
  return (
    <dialog className="dialog" open>
      <div className="column" style={{ gap: 10 }}>
        <h3>Run on all calls in scope</h3>
        <p>
          {estimate.count.toLocaleString()} completely masked calls · about {estimate.estimatedTokens.toLocaleString()} input tokens on {estimate.modelEndpoint}.
          {estimate.inputCost != null ? ` Estimated cost ${estimate.costCurrency} ${(estimate.inputCost + (estimate.outputCost ?? 0)).toFixed(2)}.` : ''}
        </p>
        <p className="small muted">This cohort is frozen until {fmtDate(estimate.expiresAt)}; access and transcripts are re-checked before the run starts.</p>
        <div className="row">
          <button className="btn primary" type="button" onClick={onConfirm}>
            Start full run
          </button>
          <button className="btn" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
