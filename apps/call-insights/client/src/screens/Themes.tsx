import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { ThemeDetail as Detail } from '../../../shared/insights';
import { Filters, useUrlScope } from '../components/Filters';
import { Icon } from '../components/Icon';
import { Async, Bars, Empty, Kpi, LinkBtn } from '../components/ui';
import { ThemeMap } from '../components/ThemeMap';
import { useData, useSource } from '../data/source';
import { fmtDate, fmtDuration, fmtTime } from '../lib/format';
import { fmtDay, scopeLabel, selectionParams } from '../lib/scope';
import { toPath } from '../router';
import { useWorkspace } from '../store';

export function Themes() {
  const { scope } = useUrlScope();
  const { bounds } = useWorkspace();
  const ready = bounds.data !== undefined || bounds.error !== null;
  const themes = useData(`themes:${JSON.stringify(scope)}`, (source) => source.themes(scope), ready);
  return (
    <section className="screen">
      <div className="row between page-heading">
        <div className="column">
          <span className="eyebrow">DISCOVER</span>
          <h2>Themes</h2>
          <p className="muted">Groups of similar conversations, discovered from AI summaries. Open one to see the calls behind it.</p>
        </div>
        <Filters />
      </div>
      <Async value={themes} label="Loading themes…" skeleton="list">
        {(data) =>
          !data.run ? (
            <Empty>
              <p>No theme run has completed yet.</p>
              <p className="small">Run the theme builder job (resources/theme-builder.yml) after enriching calls. Themes appear here when it finishes.</p>
            </Empty>
          ) : (
            <>
              <div className="scope-strip">
                <span>
                  <strong>{data.themedInScope.toLocaleString()} themed calls</strong> of {data.callsInScope.toLocaleString()} in scope
                </span>
                <span>
                  {data.run.method} · built {fmtDate(data.run.createdAt)}
                  {data.run.purity != null ? ` · ${Math.round(data.run.purity * 100)}% agreement with reference intents` : ''}
                </span>
              </div>
              <MapPanel scope={scope} themes={data.themes} />
              <div className="box">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Theme</th>
                      <th>Calls</th>
                      <th>Previous period</th>
                      <th>Avg duration</th>
                      <th>Negative end</th>
                      <th>Mostly</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.themes.map((theme) => (
                      <tr key={theme.id}>
                        <td>
                          <LinkBtn to={{ name: 'theme', id: theme.id }}>{theme.name}</LinkBtn>
                          <span className="small muted cell-secondary">{theme.description}</span>
                        </td>
                        <td className="mono">{theme.calls.toLocaleString()}</td>
                        <td className="mono">{theme.previousCalls ? theme.previousCalls.toLocaleString() : '—'}</td>
                        <td className="mono">{theme.avgDurationSeconds != null ? fmtDuration(theme.avgDurationSeconds) : '—'}</td>
                        <td className="mono">{theme.sentimentEvaluated ? `${Math.round((theme.negative / theme.sentimentEvaluated) * 100)}%` : '—'}</td>
                        <td>{theme.topQueue ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        }
      </Async>
    </section>
  );
}

export function ThemeDetail() {
  const { id = '' } = useParams();
  const { scope } = useUrlScope();
  const { bounds } = useWorkspace();
  const ready = bounds.data !== undefined || bounds.error !== null;
  const detail = useData(`theme:${id}:${JSON.stringify(scope)}`, (source) => source.theme(scope, id), ready);
  return (
    <section className="screen">
      <div className="crumb">
        <LinkBtn to={{ name: 'themes' }}>Themes</LinkBtn> / Pattern
      </div>
      <Async value={detail} label="Loading theme…" skeleton="detail">
        {(data) => <ThemeBody data={data} />}
      </Async>
    </section>
  );
}

function ThemeBody({ data }: { data: Detail }) {
  const source = useSource();
  const navigate = useNavigate();
  const { selection, bounds, scope } = useWorkspace();
  const [saved, setSaved] = useState<{ caseId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const cases = useData('cases:list', (s) => s.cases.list());
  const theme = data.theme;
  const scopeText = scopeLabel(selection, bounds.data);
  const maxDay = Math.max(...data.daily.map((d) => d.calls), 1);
  const themeReturn = `/themes/${encodeURIComponent(theme.id)}?${new URLSearchParams(selectionParams(selection)).toString()}`;
  const target = cases.data?.find((c) => !c.shared);

  async function saveToCase() {
    setSaving(true);
    setError('');
    try {
      const record = target ? await source.cases.get(target.id) : await source.cases.create(`Investigating: ${theme.name}`);
      await source.cases.addItem(
        record.id,
        {
          type: 'theme',
          refId: theme.id,
          title: theme.name,
          scope: scopeText,
          note: `${theme.calls} calls in this theme of ${data.callsInScope} in scope (${scopeText}). AI-discovered theme; no causal or corpus-wide inference.`,
        },
        record.version
      );
      setSaved({ caseId: record.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save to the case.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="row between page-heading">
        <div className="column">
          <span className="eyebrow">INVESTIGATE A PATTERN</span>
          <h2>{theme.name}</h2>
          <p className="muted">{theme.description}</p>
        </div>
        <Filters />
      </div>
      <div className="scope-strip">
        <span>
          <strong>{theme.calls.toLocaleString()} matching calls</strong> of {data.callsInScope.toLocaleString()} in selected scope
        </span>
        <span>
          {scopeText} · {data.run.method}
        </span>
      </div>
      <div className="row between">
        <LinkBtn to={{ name: 'explore', filters: { theme: theme.id } }} className="btn primary">
          Explore matching calls →
        </LinkBtn>
        <div className="row">
          <button
            className="btn"
            type="button"
            onClick={() =>
              void navigate(
                toPath({
                  name: 'label',
                  id: 'new',
                  params: { name: theme.name, definition: theme.description, queue: selection.queue, start: scope.start, end: scope.end },
                })
              )
            }
          >
            Refine as a label
          </button>
          <button className="btn" type="button" disabled={saving || Boolean(saved) || !theme.calls || cases.data === undefined} onClick={() => void saveToCase()}>
            {saved ? 'Saved to case' : saving ? 'Saving…' : target ? `Save to “${target.title}”` : 'Save to a new case'}
          </button>
        </div>
      </div>
      {saved ? (
        <p className="small" role="status">
          Theme saved with its scope. <LinkBtn to={{ name: 'case', id: saved.caseId }}>Open case →</LinkBtn>
        </p>
      ) : null}
      {error ? (
        <p className="small warn" role="alert">
          {error}
        </p>
      ) : null}

      <div className="kpis">
        <Kpi
          label="Matching conversations"
          value={theme.calls.toLocaleString()}
          delta={theme.previousCalls ? `${theme.previousCalls} in the previous equal period` : 'No calls in the previous equal period'}
        />
        <Kpi label="Average call duration" value={theme.avgDurationSeconds != null ? fmtDuration(theme.avgDurationSeconds) : '—'} delta="Recording duration · matching calls" />
        <Kpi label="Repeat contact mentioned" value={theme.repeatEvaluated ? `${theme.repeatMentions} / ${theme.repeatEvaluated}` : '—'} delta="AI mention · not a measured repeat rate" />
        <Kpi label="Negative end sentiment" value={theme.sentimentEvaluated ? `${theme.negative} / ${theme.sentimentEvaluated}` : '—'} delta="AI annotation · verify each conversation" />
      </div>

      <div className="cols cols-even">
        <div className="box">
          <h3>Matching calls by queue</h3>
          {data.byQueue.length ? (
            <dl>
              {data.byQueue.map((q) => (
                <QueueRow key={q.queue} queue={q.queue} calls={q.calls} duration={q.avgDurationSeconds} />
              ))}
            </dl>
          ) : (
            <Empty>No matches in this scope.</Empty>
          )}
          <h3 style={{ marginTop: 20 }}>Contact reasons inside this theme</h3>
          <Bars items={data.reasons.slice(0, 6).map((r) => ({ name: r.name, share: r.calls / Math.max(theme.calls, 1), right: String(r.calls) }))} />
        </div>
        <div className="box">
          <h3>Calls per recording day</h3>
          {data.daily.length ? (
            <div className="mini-trend" role="img" aria-label="Calls in this theme per recording day">
              {data.daily.map((d) => (
                <span key={d.date} title={`${fmtDay(d.date)}: ${d.calls}`}>
                  <i style={{ height: `${(d.calls / maxDay) * 100}%` }} />
                  <small>{fmtDay(d.date, false)}</small>
                </span>
              ))}
            </div>
          ) : (
            <Empty>No recording days in this scope.</Empty>
          )}
          <p className="small muted">Only days with recordings are shown. Compare periods with the scope selector.</p>
        </div>
      </div>

      <div className="box">
        <div className="row between">
          <h3>Conversations to review</h3>
          <span className="small muted">Closest to the theme centre first</span>
        </div>
        {!data.representatives.length ? (
          <Empty>
            No calls match this theme in the selected scope. <LinkBtn to={{ name: 'explore' }}>Explore this scope</LinkBtn>
          </Empty>
        ) : (
          <ul className="list">
            {data.representatives.map((call) => (
              <li key={call.id}>
                <div className="row between">
                  <LinkBtn to={{ name: 'call', id: call.id, from: themeReturn, t: call.excerptStart ?? undefined }}>
                    {call.id} · {fmtDate(call.startedAt)} · {fmtDuration(call.durationSeconds)}
                  </LinkBtn>
                  {call.sentimentEnd ? <span className="tag">AI end sentiment: {call.sentimentEnd}</span> : null}
                </div>
                <p className="small muted">
                  {call.queue}
                  {call.excerpt ? (
                    <>
                      {' '}
                      · {call.excerptStart != null ? `${fmtTime(call.excerptStart)} ` : ''}“{call.excerpt}”
                    </>
                  ) : (
                    ' · masked transcript pending'
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
        <LinkBtn className="subtle-link" to={{ name: 'explore', filters: { theme: theme.id } }}>
          See all {theme.calls.toLocaleString()} calls <Icon name="arrow" size={15} />
        </LinkBtn>
      </div>
    </>
  );
}

function QueueRow({ queue, calls, duration }: { queue: string; calls: number; duration: number | null }) {
  return (
    <>
      <dt>{queue}</dt>
      <dd>
        {calls} calls{duration != null ? ` · ${fmtDuration(duration)} avg duration` : ''}
      </dd>
    </>
  );
}

function MapPanel({ scope, themes }: { scope: import('../../../shared/insights').Scope; themes: import('../../../shared/insights').ThemeSummary[] }) {
  const navigate = useNavigate();
  const { selection } = useWorkspace();
  const map = useData(`theme-map:${JSON.stringify(scope)}`, (source) => source.themeMap(scope));
  const from = `/themes?${new URLSearchParams(selectionParams(selection)).toString()}`;
  return (
    <div className="box">
      <div className="row between">
        <div className="column">
          <h3>Theme map</h3>
          <span className="small muted">Every themed call in scope, placed by similarity</span>
        </div>
        {map.data ? <span className="small muted">{map.data.points.length.toLocaleString()} calls{map.data.truncated ? ' (first 5,000)' : ''}</span> : null}
      </div>
      <Async value={map} label="Placing calls…">
        {(data) =>
          data.points.length ? (
            <ThemeMap points={data.points} themes={themes} onOpen={(id) => void navigate(toPath({ name: 'call', id, from }))} />
          ) : (
            <Empty>No themed calls with map positions in this scope. Re-run the theme builder to add map coordinates.</Empty>
          )
        }
      </Async>
    </div>
  );
}
