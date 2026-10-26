import { useSearchParams } from 'react-router';
import type { ChangesData, Focus, OverviewData, Scope, ThemesData } from '../../../shared/insights';
import { ReasonChart, VolumeChart } from '../components/LazyCharts';
import { Filters, useUrlScope } from '../components/Filters';
import { Icon } from '../components/Icon';
import { Async, CountUp, Empty, ErrorNote, Kpi, LinkBtn, Loading } from '../components/ui';
import { useData } from '../data/source';
import { fmtDuration } from '../lib/format';
import { dayPeriod, metricChange, periodDay, rangeLabel } from '../lib/scope';
import type { Route } from '../router';
import { useWorkspace } from '../store';

export function Overview() {
  const { scope, selection } = useUrlScope();
  const [params, setParams] = useSearchParams();
  const { bounds } = useWorkspace();
  const focus: Focus = { reason: params.get('focus_reason') ?? '', theme: params.get('focus_theme') ?? '' };
  const key = JSON.stringify({ scope, focus });
  const ready = bounds.data !== undefined || bounds.error !== null;
  const overview = useData(`overview:${key}`, (source) => source.overview(scope, focus), ready);
  const changes = useData(`changes:${JSON.stringify(scope)}`, (source) => source.changes(scope), ready);
  const themes = useData(`themes:${JSON.stringify({ scope, reason: focus.reason })}`, (source) => source.themes(scope, { reason: focus.reason, theme: '' }), ready);
  const previousScope = overview.data && overview.data.previousCalls > 0 ? previousOf(scope, overview.data) : null;
  const previous = useData(`overview-prev:${JSON.stringify({ previousScope, focus })}`, (source) => source.overview(previousScope!, focus), Boolean(previousScope));

  function setFocus(patch: Partial<Focus> & { day?: string }) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries({ focus_reason: patch.reason, focus_theme: patch.theme }))
      if (v === undefined) continue;
      else if (v) next.set(k, v);
      else next.delete(k);
    if (patch.day) {
      next.set('period', dayPeriod(patch.day));
      next.set('queue', selection.queue || 'all');
    }
    setParams(next, { replace: !patch.day });
  }
  const themeName = themes.data?.themes.find((t) => t.id === focus.theme)?.name ?? focus.theme;

  return (
    <section className="screen overview-screen">
      <div className="row between page-heading">
        <div className="column">
          <span className="eyebrow">LISTEN. UNDERSTAND. IMPROVE.</span>
          <h2>
            Conversation overview<span className="title-dot">.</span>
          </h2>
          <p className="muted">Find the friction. Follow the evidence.</p>
        </div>
        <Filters />
      </div>
      <FocusBar
        focus={focus}
        themeName={themeName}
        reasons={overview.data?.reasons.map((r) => r.name) ?? []}
        themes={themes.data?.themes.filter((t) => t.calls > 0) ?? []}
        day={periodDay(selection.period)}
        onFocus={setFocus}
        onClearDay={() => {
          const next = new URLSearchParams(params);
          next.set('period', 'all');
          setParams(next);
        }}
      />
      <Async value={overview} label="Loading conversation metrics…" skeleton="overview">
        {(data) => (
          <>
            <Kpis data={data} />
            {data.calls === 0 ? (
              <Empty>No conversations match this focus. Remove a filter above, or choose another queue or a longer period.</Empty>
            ) : (
              <>
                <div className="overview-grid">
                  <ChangesPanel value={changes.data} error={changes.error} retry={changes.reload} themes={themes.data} />
                  <WorkflowCard />
                </div>
                <div className="overview-grid charts-grid">
                  <div className="box volume-panel">
                    <div className="row between">
                      <div className="column">
                        <h3>Conversation volume</h3>
                        <span className="small muted">
                          Calls per recording day · {rangeLabel(data.periodStart, data.periodEnd)}
                          {previous.data ? ' · grey: “Calls before”, the same day in the previous equal period' : ''}
                        </span>
                      </div>
                      <span className="chart-total">
                        <CountUp value={data.calls} />
                        <small>calls</small>
                      </span>
                    </div>
                    {data.daily.length ? (
                      <VolumeChart current={data} previous={previous.data} focusDay={periodDay(selection.period)} onDay={(day) => setFocus({ day })} />
                    ) : (
                      <p className="muted small">No recordings in this period.</p>
                    )}
                    <span className="small muted">Hover for counts. Click a day to focus the whole overview on it.</span>
                  </div>
                  <Reasons data={data} focus={focus.reason} onFocus={(reason) => setFocus({ reason })} />
                </div>
                <Patterns value={themes.data} error={themes.error} retry={themes.reload} focus={focus.theme} onFocus={(theme) => setFocus({ theme })} />
              </>
            )}
            <p className="data-footnote">
              <Icon name="shield" size={13} /> {rangeLabel(data.periodStart, data.periodEnd)} compared with the previous equal-length
              period from {data.previousStart}. Sentiment, contact reasons and repeat mentions are AI annotations covering{' '}
              {data.enriched.toLocaleString()} of {data.calls.toLocaleString()} calls; verify against the transcript.
            </p>
          </>
        )}
      </Async>
    </section>
  );
}

function previousOf(scope: Scope, data: OverviewData): Scope {
  const end = new Date(`${data.periodStart}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return { queue: scope.queue, start: data.previousStart, end: end.toISOString().slice(0, 10) };
}

function FocusBar({
  focus,
  themeName,
  reasons,
  themes,
  day,
  onFocus,
  onClearDay,
}: {
  focus: Focus;
  themeName: string;
  reasons: string[];
  themes: { id: string; name: string }[];
  day: string;
  onFocus: (patch: Partial<Focus>) => void;
  onClearDay: () => void;
}) {
  const active = Boolean(focus.reason || focus.theme || day);
  return (
    <div className={`focus-bar${active ? ' active' : ''}`} aria-label="Overview focus">
      <span className="eyebrow">FOCUS</span>
      {day ? (
        <button className="focus-chip" type="button" onClick={onClearDay}>
          Day · {rangeLabel(day, day)} <span aria-hidden="true">×</span>
          <span className="sr-only">Remove day focus</span>
        </button>
      ) : null}
      {focus.reason ? (
        <button className="focus-chip" type="button" onClick={() => onFocus({ reason: '' })}>
          Reason · {focus.reason} <span aria-hidden="true">×</span>
          <span className="sr-only">Remove reason focus</span>
        </button>
      ) : null}
      {focus.theme ? (
        <button className="focus-chip" type="button" onClick={() => onFocus({ theme: '' })}>
          Theme · {themeName} <span aria-hidden="true">×</span>
          <span className="sr-only">Remove theme focus</span>
        </button>
      ) : null}
      {!active ? <span className="small muted">Click a day, a reason or a theme below to focus every panel on it.</span> : null}
      <span className="focus-pickers">
        <label className="sr-only" htmlFor="focus-reason">
          Focus on a contact reason
        </label>
        <select id="focus-reason" className="select compact" value={focus.reason} onChange={(e) => onFocus({ reason: e.target.value })}>
          <option value="">Any reason</option>
          {focus.reason && !reasons.includes(focus.reason) ? <option value={focus.reason}>{focus.reason}</option> : null}
          {reasons.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="focus-theme">
          Focus on a theme
        </label>
        <select id="focus-theme" className="select compact" value={focus.theme} onChange={(e) => onFocus({ theme: e.target.value })}>
          <option value="">Any theme</option>
          {focus.theme && !themes.some((t) => t.id === focus.theme) ? <option value={focus.theme}>{themeName}</option> : null}
          {themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}

function Kpis({ data }: { data: OverviewData }) {
  const tone = (current: number | null, previous: number | null) =>
    current != null && previous != null && current > previous ? 'bad' : 'neutral';
  return (
    <div className="kpis">
      <Kpi
        label="Calls in scope"
        value={<CountUp value={data.calls} />}
        delta={data.previousCalls ? metricChange(data.calls, data.previousCalls, 'percent') : 'No calls in the previous equal period'}
      />
      <Kpi
        label="Average call duration"
        value={data.avgDurationSeconds != null ? fmtDuration(data.avgDurationSeconds) : '—'}
        delta={data.previousCalls ? metricChange(data.avgDurationSeconds, data.previousAvgDurationSeconds, 'seconds') : 'Recording duration · excludes wrap-up'}
        tone={tone(data.avgDurationSeconds, data.previousAvgDurationSeconds)}
      />
      <Kpi
        label="Negative closing sentiment"
        value={data.negativeShare != null ? <CountUp value={data.negativeShare * 100} format={(n) => `${Math.round(n)}%`} /> : '—'}
        delta={
          data.sentimentEvaluated
            ? `${data.sentimentEvaluated.toLocaleString()} evaluated · ${metricChange(data.negativeShare, data.previousSentimentEvaluated ? data.previousNegativeShare : null, 'points')}`
            : 'Not evaluated in this scope'
        }
        tone={tone(data.negativeShare, data.previousNegativeShare)}
      />
      <Kpi
        label="Repeat contact mentioned"
        value={data.repeatShare != null ? <CountUp value={data.repeatShare * 100} format={(n) => `${Math.round(n)}%`} /> : '—'}
        delta={data.repeatEvaluated ? `${data.repeatEvaluated.toLocaleString()} evaluated · mention, not a measured repeat rate` : 'Not evaluated in this scope'}
      />
    </div>
  );
}

function changeRoute(kind: string, id: string): Route {
  if (kind === 'theme') return { name: 'theme', id };
  if (kind === 'label') return { name: 'label', id };
  return { name: 'explore', filters: { reason: id } };
}

function ChangesPanel({
  value,
  error,
  retry,
  themes,
}: {
  value: ChangesData | undefined;
  error: import('../data/source').DataError | null;
  retry: () => void;
  themes: ThemesData | undefined;
}) {
  const featured = themes?.themes.find((t) => t.calls > 0);
  return (
    <div className="box featured-investigation">
      <div className="row between">
        <span className="eyebrow">
          <span className="status-dot" /> WHAT&apos;S CHANGED
        </span>
        <span className="tag red-tag">VS PREVIOUS EQUAL PERIOD</span>
      </div>
      {error ? (
        <ErrorNote error={error} retry={retry} />
      ) : !value ? (
        <Loading label="Comparing periods…" />
      ) : !value.comparable ? (
        <div className="featured-body">
          <div className="featured-copy">
            <span className="small muted">No baseline yet</span>
            <h3>{featured ? featured.name : 'Choose a shorter period to compare'}</h3>
            <p>
              The previous equal-length period has no recordings, so no change can be measured. Pick &ldquo;Latest day&rdquo; or a
              shorter window with recordings before it.
              {featured ? ' Meanwhile, this is the largest theme in scope.' : ''}
            </p>
          </div>
          {featured ? (
            <div className="spotlight-count">
              <strong>{featured.calls.toLocaleString()}</strong>
              <span>calls in this theme</span>
            </div>
          ) : null}
        </div>
      ) : value.changes.length === 0 ? (
        <div className="featured-copy">
          <h3>Nothing moved past ±{Math.round(value.threshold * 100)}%</h3>
          <p className="muted">
            Contact reasons, themes and tracked labels are within ±{Math.round(value.threshold * 100)}% of their share in the previous period (
            {value.previousCalls.toLocaleString()} {value.previousCalls === 1 ? 'call' : 'calls'}).
          </p>
        </div>
      ) : (
        <div className="change-list">
          {value.changes.slice(0, 4).map((change) => (
            <LinkBtn key={`${change.kind}:${change.id}`} className="change-row" to={changeRoute(change.kind, change.id)}>
              <span className="change-main">
                <span className="tag">{change.kind === 'reason' ? 'Contact reason' : change.kind === 'theme' ? 'Theme' : 'Tracked label'}</span>
                <strong>{change.name}</strong>
                <small className="muted">
                  {change.current} calls ({Math.round(change.currentShare * 100)}% of evaluated) vs {change.previous} (
                  {Math.round(change.previousShare * 100)}%)
                  {change.currentAvgDurationSeconds != null ? ` · ${fmtDuration(change.currentAvgDurationSeconds)} avg` : ''}
                  {change.topQueue && change.topQueueShare != null ? ` · ${Math.round(change.topQueueShare * 100)}% in ${change.topQueue}` : ''}
                </small>
              </span>
              <b className={change.changePct > 0 ? 'delta-bad' : 'delta-good'}>
                {change.changePct > 0 ? '▲' : '▼'} {Math.abs(Math.round(change.changePct * 100))}%
              </b>
            </LinkBtn>
          ))}
          <span className="small muted">
            Share of evaluated calls, flagged at ±{Math.round(value.threshold * 100)}% and at least {value.minCalls} calls. Observational, not causal.
          </span>
        </div>
      )}
    </div>
  );
}

function WorkflowCard() {
  const cases = useData('cases:list', (source) => source.cases.list());
  const count = cases.data?.length ?? 0;
  return (
    <div className="box workflow-card">
      <span className="eyebrow">YOUR NEXT FINDING</span>
      <h3>
        Build a case.
        <br />
        Back it with evidence.
      </h3>
      <ol className="workflow-steps">
        <li>
          <span>01</span>Find a relevant conversation
        </li>
        <li>
          <span>02</span>Review a timestamped moment
        </li>
        <li>
          <span>03</span>Save the excerpt and your note
        </li>
      </ol>
      <LinkBtn className="workflow-link" to={{ name: 'cases' }}>
        {cases.data ? `${count} saved ${count === 1 ? 'investigation' : 'investigations'}` : 'Investigations'} <Icon name="arrow" size={16} />
      </LinkBtn>
    </div>
  );
}

function Reasons({ data, focus, onFocus }: { data: OverviewData; focus: string; onFocus: (reason: string) => void }) {
  const total = data.reasons.reduce((sum, r) => sum + r.calls, 0);
  return (
    <div className="box reason-panel">
      <div className="row between">
        <div className="column">
          <h3>Why customers called</h3>
          <span className="small muted">
            AI contact reason · {total.toLocaleString()} of {data.calls.toLocaleString()} calls evaluated
          </span>
        </div>
        {focus ? (
          <LinkBtn className="subtle-link" to={{ name: 'explore', filters: { reason: focus } }}>
            Open calls <Icon name="arrow" size={14} />
          </LinkBtn>
        ) : (
          <Icon name="explore" size={17} />
        )}
      </div>
      {data.reasons.length ? (
        <ReasonChart reasons={data.reasons} selected={focus} onSelect={onFocus} />
      ) : (
        <p className="muted small">No contact reasons have been evaluated in this scope yet.</p>
      )}
      <span className="small muted">Click a reason to focus the overview on it; click again to clear.</span>
    </div>
  );
}

function Patterns({
  value,
  error,
  retry,
  focus,
  onFocus,
}: {
  value: ThemesData | undefined;
  error: import('../data/source').DataError | null;
  retry: () => void;
  focus: string;
  onFocus: (theme: string) => void;
}) {
  const shown = value?.themes.filter((t) => t.calls > 0).slice(0, 6) ?? [];
  const max = Math.max(...shown.map((t) => t.calls), 1);
  return (
    <div className="box patterns-panel">
      <div className="row between">
        <div className="column">
          <h3>Themes to investigate</h3>
          <span className="small muted">
            {value?.run
              ? `${value.run.method} · ${value.themedInScope.toLocaleString()} of ${value.callsInScope.toLocaleString()} calls themed · verify against the transcript`
              : 'Clusters of similar conversations'}
          </span>
        </div>
        <div className="row">
          <LinkBtn className="subtle-link" to={{ name: 'themes' }}>
            Theme map <Icon name="arrow" size={15} />
          </LinkBtn>
        </div>
      </div>
      {error ? (
        <ErrorNote error={error} retry={retry} />
      ) : !value ? (
        <Loading label="Loading themes…" />
      ) : !value.run ? (
        <p className="muted">No theme run has completed yet. Run the theme builder job to discover themes across enriched calls.</p>
      ) : (
        <div className="pattern-list">
          {shown.map((theme, index) => {
            const change = theme.previousCalls ? (theme.calls - theme.previousCalls) / theme.previousCalls : null;
            return (
              <div key={theme.id} className={`pattern-row${focus === theme.id ? ' focused' : ''}`}>
                <span className="pattern-number">{String(index + 1).padStart(2, '0')}</span>
                <button className="pattern-title pattern-focus" type="button" aria-pressed={focus === theme.id} onClick={() => onFocus(focus === theme.id ? '' : theme.id)}>
                  {theme.name}
                  <small>
                    {theme.topQueue ? `Mostly ${theme.topQueue}` : ''}
                    {change != null ? ` · ${change > 0 ? '▲' : '▼'} ${Math.abs(Math.round(change * 100))}% vs previous` : ''}
                  </small>
                </button>
                <span className="pattern-meter" aria-hidden="true">
                  <i style={{ width: `${(theme.calls / max) * 100}%` }} />
                </span>
                <b>{theme.calls.toLocaleString()} calls</b>
                <LinkBtn className="pattern-open" to={{ name: 'theme', id: theme.id }}>
                  <Icon name="arrow" size={17} />
                  <span className="sr-only">Open {theme.name}</span>
                </LinkBtn>
              </div>
            );
          })}
          {!shown.length ? <p className="muted">No themed calls in this scope.</p> : null}
        </div>
      )}
      <span className="small muted">Click a theme name to focus the overview on it. The arrow opens the theme.</span>
    </div>
  );
}
