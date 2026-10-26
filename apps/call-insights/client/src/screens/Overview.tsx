import type { ChangesData, OverviewData, ThemesData } from '../../../shared/insights';
import { Filters, useUrlScope } from '../components/Filters';
import { Icon } from '../components/Icon';
import { Trend } from '../components/Trend';
import { Async, Empty, ErrorNote, Kpi, LinkBtn, Loading } from '../components/ui';
import { useData } from '../data/source';
import { fmtDuration } from '../lib/format';
import { metricChange, rangeLabel } from '../lib/scope';
import type { Route } from '../router';
import { useWorkspace } from '../store';

export function Overview() {
  const { scope } = useUrlScope();
  const { bounds } = useWorkspace();
  const key = JSON.stringify(scope);
  const ready = bounds.data !== undefined || bounds.error !== null;
  const overview = useData(`overview:${key}`, (source) => source.overview(scope), ready);
  const changes = useData(`changes:${key}`, (source) => source.changes(scope), ready);
  const themes = useData(`themes:${key}`, (source) => source.themes(scope), ready);
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
      <Async value={overview} label="Loading conversation metrics…">
        {(data) => (
          <>
            <Kpis data={data} />
            {data.calls === 0 ? (
              <Empty>No conversations in this scope. Choose another queue or a longer period.</Empty>
            ) : (
              <>
                <div className="overview-grid">
                  <ChangesPanel value={changes.data} error={changes.error} retry={changes.reload} themes={themes.data} />
                  <WorkflowCard />
                </div>
                <div className="overview-grid charts-grid">
                  <Trend overview={data} />
                  <Reasons data={data} />
                </div>
                <Patterns value={themes.data} error={themes.error} retry={themes.reload} total={data.calls} />
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

function Kpis({ data }: { data: OverviewData }) {
  const tone = (current: number | null, previous: number | null) =>
    current != null && previous != null && current > previous ? 'bad' : 'neutral';
  return (
    <div className="kpis">
      <Kpi
        label="Calls in scope"
        value={data.calls.toLocaleString()}
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
        value={data.negativeShare != null ? `${Math.round(data.negativeShare * 100)}%` : '—'}
        delta={
          data.sentimentEvaluated
            ? `${data.sentimentEvaluated.toLocaleString()} evaluated · ${metricChange(data.negativeShare, data.previousSentimentEvaluated ? data.previousNegativeShare : null, 'points')}`
            : 'Not evaluated in this scope'
        }
        tone={tone(data.negativeShare, data.previousNegativeShare)}
      />
      <Kpi
        label="Repeat contact mentioned"
        value={data.repeatShare != null ? `${Math.round(data.repeatShare * 100)}%` : '—'}
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

function Reasons({ data }: { data: OverviewData }) {
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
        <Icon name="explore" size={17} />
      </div>
      {data.reasons.length ? (
        <div className="reason-bars">
          {data.reasons.slice(0, 9).map((reason) => (
            <LinkBtn key={reason.name} className="reason-row" to={{ name: 'explore', filters: { reason: reason.name } }}>
              <span className="row between">
                <span>{reason.name}</span>
                <b>
                  {reason.calls.toLocaleString()} <Icon name="chevron" size={12} />
                </b>
              </span>
              <span className="reason-track">
                <i style={{ width: `${(reason.calls / Math.max(total, 1)) * 100}%` }} />
              </span>
            </LinkBtn>
          ))}
        </div>
      ) : (
        <p className="muted small">No contact reasons have been evaluated in this scope yet.</p>
      )}
      <span className="small muted">Select a reason to explore the same cohort.</span>
    </div>
  );
}

function Patterns({ value, error, retry, total }: { value: ThemesData | undefined; error: import('../data/source').DataError | null; retry: () => void; total: number }) {
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
        <LinkBtn className="subtle-link" to={{ name: 'themes' }}>
          All themes <Icon name="arrow" size={15} />
        </LinkBtn>
      </div>
      {error ? (
        <ErrorNote error={error} retry={retry} />
      ) : !value ? (
        <Loading label="Loading themes…" />
      ) : !value.run ? (
        <p className="muted">No theme run has completed yet. Run the theme builder job to discover themes across enriched calls.</p>
      ) : (
        <div className="pattern-list">
          {value.themes
            .filter((t) => t.calls > 0)
            .slice(0, 6)
            .map((theme, index) => (
              <LinkBtn key={theme.id} className="pattern-row" to={{ name: 'theme', id: theme.id }}>
                <span className="pattern-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="pattern-title">
                  {theme.name}
                  <small>{theme.topQueue ? `Mostly ${theme.topQueue}` : ''}</small>
                </span>
                <span className="pattern-meter">
                  <i style={{ width: `${(theme.calls / Math.max(total, 1)) * 100}%` }} />
                </span>
                <b>{theme.calls.toLocaleString()} calls</b>
                <Icon name="arrow" size={17} />
              </LinkBtn>
            ))}
          {!value.themes.some((t) => t.calls > 0) ? <p className="muted">No themed calls in this scope.</p> : null}
        </div>
      )}
    </div>
  );
}
