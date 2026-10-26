import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { ExploreFilters, ExploreRow } from '../../../shared/insights';
import { Filters, useUrlScope } from '../components/Filters';
import { Async, Empty, LinkBtn } from '../components/ui';
import { useData } from '../data/source';
import { fmtDate, fmtDuration, fmtTime } from '../lib/format';
import { DEFAULT_FILTERS, filterParams, readFilters, selectionParams } from '../lib/scope';
import { toPath } from '../router';
import { useWorkspace } from '../store';

export function Explore() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { selection, scope } = useUrlScope();
  const { bounds } = useWorkspace();
  const filters = readFilters(params);
  const [draft, setDraft] = useState(filters.q);
  const ready = bounds.data !== undefined || bounds.error !== null;
  const key = JSON.stringify({ scope, filters });
  const results = useData(`explore:${key}`, (source) => source.explore(scope, filters), ready);
  const overview = useData(`overview:${JSON.stringify(scope)}`, (source) => source.overview(scope), ready);
  const themes = useData(`themes:${JSON.stringify(scope)}`, (source) => source.themes(scope), ready);
  const returnPath = `/explore?${new URLSearchParams({ ...selectionParams(selection), ...filterParams(filters) }).toString()}`;
  const activeTheme = themes.data?.themes.find((t) => t.id === filters.theme);
  const hasFilters = Boolean(filters.q || filters.reason || filters.theme || filters.sentiment || filters.silence);

  function update(patch: Partial<ExploreFilters>, resetPage = true) {
    const next = { ...filters, ...patch, page: resetPage ? 1 : (patch.page ?? filters.page) };
    // Refinements replace the URL so Back returns to where the analyst came from.
    setParams(new URLSearchParams({ ...selectionParams(selection), ...filterParams(next) }), { replace: true });
    if (patch.q !== undefined) setDraft(patch.q);
  }

  function saveAsLabel() {
    const name = filters.q || activeTheme?.name || filters.reason || 'New label';
    const definition = filters.q
      ? `The conversation contains or describes “${filters.q}”. Refine this definition before testing.`
      : activeTheme
        ? activeTheme.description
        : `Investigate: ${name}. Refine this definition before testing.`;
    void navigate(toPath({ name: 'label', id: 'new', params: { name, definition, queue: selection.queue, start: scope.start, end: scope.end } }));
  }

  return (
    <section className="screen explore-screen">
      <div className="row between page-heading">
        <div className="column">
          <span className="eyebrow">INVESTIGATE</span>
          <h2>Explore conversations</h2>
          <p className="muted">Find the pattern. Open the evidence. Build your case.</p>
        </div>
        <button className="btn" type="button" onClick={saveAsLabel}>
          Save as label ↗
        </button>
      </div>

      <div className="box filter-panel">
        <div className="explore-toolbar">
          <form
            className="search-field"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              update({ q: draft.trim() });
            }}
          >
            <label>
              Search masked transcripts
              <input className="input" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Search words or an exact phrase, then press Enter…" />
            </label>
          </form>
          <Filters />
        </div>
        <div className="row filter-secondary">
          <label>
            Contact reason · AI generated
            <select className="select" value={filters.reason} onChange={(event) => update({ reason: event.target.value })}>
              <option value="">All reasons</option>
              {filters.reason && !overview.data?.reasons.some((r) => r.name === filters.reason) ? <option value={filters.reason}>{filters.reason}</option> : null}
              {overview.data?.reasons.map((reason) => (
                <option key={reason.name} value={reason.name}>
                  {reason.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            End sentiment · AI generated
            <select className="select" value={filters.sentiment} onChange={(event) => update({ sentiment: event.target.value as ExploreFilters['sentiment'] })}>
              <option value="">Any sentiment</option>
              <option value="negative">Negative</option>
              <option value="neutral">Neutral</option>
              <option value="positive">Positive</option>
            </select>
          </label>
          <label>
            Theme · AI generated
            <select className="select" value={filters.theme} onChange={(event) => update({ theme: event.target.value })}>
              <option value="">All themes</option>
              {filters.theme && !activeTheme ? <option value={filters.theme}>{filters.theme}</option> : null}
              {themes.data?.themes.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-filter">
            <input type="checkbox" checked={filters.silence} onChange={(event) => update({ silence: event.target.checked })} />
            Silence ≥ 10 seconds
          </label>
          {hasFilters ? (
            <button className="link clear-filters" type="button" onClick={() => update({ ...DEFAULT_FILTERS })}>
              Clear filters
            </button>
          ) : null}
        </div>
        {hasFilters ? (
          <div className="active-filters" aria-label="Active search filters">
            {filters.q ? (
              <button className="tag" type="button" onClick={() => update({ q: '' })}>
                Contains “{filters.q}” ×
              </button>
            ) : null}
            {filters.reason ? (
              <button className="tag" type="button" onClick={() => update({ reason: '' })}>
                {filters.reason} ×
              </button>
            ) : null}
            {filters.theme ? (
              <button className="tag" type="button" onClick={() => update({ theme: '' })}>
                {activeTheme?.name ?? filters.theme} ×
              </button>
            ) : null}
            {filters.sentiment ? (
              <button className="tag" type="button" onClick={() => update({ sentiment: '' })}>
                {filters.sentiment} sentiment ×
              </button>
            ) : null}
            {filters.silence ? (
              <button className="tag" type="button" onClick={() => update({ silence: false })}>
                Silence ≥ 10s ×
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <Async value={results} label="Searching conversations…" skeleton="list">
        {(data) => {
          const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
          const page = Math.min(filters.page, pages);
          return (
            <>
              <div className="results-heading row between">
                <div className="row">
                  <h3>
                    {data.total.toLocaleString()} matching {data.total === 1 ? 'conversation' : 'conversations'}
                  </h3>
                  <span className="tag">{data.scopeTotal.toLocaleString()} in selected scope</span>
                </div>
                <span className="small muted">Newest first · exact phrase search over masked text</span>
              </div>
              <p className="small muted results-disclosure">
                AI annotations cover {data.scopeEnriched.toLocaleString()} of {data.scopeTotal.toLocaleString()} scoped calls; calls without them are
                still searchable. Reason and sentiment filters only match evaluated calls.
              </p>
              {data.rows.length === 0 ? (
                <Empty>
                  <p>No conversations match this search.</p>
                  <p className="small">Try a shorter phrase, clear a filter, or choose another queue.</p>
                  <button className="btn" type="button" onClick={() => update({ ...DEFAULT_FILTERS })}>
                    Reset search
                  </button>
                </Empty>
              ) : (
                <div className="box results-box">
                  <div className="table-scroll">
                    <table className="data results-table">
                      <thead>
                        <tr>
                          <th>Conversation &amp; matching evidence</th>
                          <th>Queue / reason</th>
                          <th>Agent</th>
                          <th>Duration</th>
                          <th>End sentiment</th>
                          <th>
                            <span className="sr-only">Review</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.rows.map((row) => (
                          <ResultRow key={row.id} row={row} keyword={filters.q} returnPath={returnPath} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="pagination row between">
                    <span className="small muted" aria-live="polite">
                      Showing {((page - 1) * data.pageSize + 1).toLocaleString()}–{Math.min(page * data.pageSize, data.total).toLocaleString()} of{' '}
                      {data.total.toLocaleString()} matching conversations
                    </span>
                    <div className="row">
                      <button className="btn" type="button" disabled={page <= 1} onClick={() => update({ page: page - 1 }, false)}>
                        ← Previous
                      </button>
                      <span className="small">
                        {page} / {pages}
                      </span>
                      <button className="btn" type="button" disabled={page >= pages} onClick={() => update({ page: page + 1 }, false)}>
                        Next →
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          );
        }}
      </Async>
    </section>
  );
}

function ResultRow({ row, keyword, returnPath }: { row: ExploreRow; keyword: string; returnPath: string }) {
  const route = { name: 'call' as const, id: row.id, from: returnPath, t: row.matchStart ?? undefined };
  return (
    <tr>
      <td>
        <div className="row call-result-title">
          <LinkBtn to={route} className="call-id">
            {row.id}
          </LinkBtn>
          <span className="small muted">{fmtDate(row.startedAt)}</span>
          {row.masking !== 'complete' ? <span className="tag">Transcript {row.masking === 'partial' ? 'partly' : 'not yet'} masked</span> : null}
        </div>
        {row.matchText ? (
          <>
            <div className="match-excerpt">
              <span className="small muted">{keyword ? 'Transcript match ' : 'Transcript '}</span>
              {highlight(row.matchText, keyword)}
            </div>
            {row.matchStart != null ? (
              <LinkBtn to={route} className="evidence-time">
                ↗ {fmtTime(row.matchStart)} · Open this moment
              </LinkBtn>
            ) : null}
          </>
        ) : (
          <span className="small muted">Masked transcript pending</span>
        )}
      </td>
      <td>
        <strong>{row.queue}</strong>
        <span className="small muted cell-secondary">{row.contactReason ?? (row.enrichment === 'failed' ? 'Annotation failed' : 'Not evaluated')}</span>
      </td>
      <td>{row.agentName}</td>
      <td className="mono">{fmtDuration(row.durationSeconds)}</td>
      <td>
        {row.sentimentEnd ? (
          <span className={`tag sentiment-${row.sentimentEnd}`}>
            <span className="status-dot" />
            {row.sentimentEnd}
          </span>
        ) : (
          <span className="small muted">Not evaluated</span>
        )}
      </td>
      <td>
        <LinkBtn to={route} className="result-arrow">
          <span aria-hidden="true">↗</span>
          <span className="sr-only">Review {row.id}</span>
        </LinkBtn>
      </td>
    </tr>
  );
}

export function highlight(text: string, keyword: string) {
  const query = keyword.trim();
  if (!query) return text;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}
