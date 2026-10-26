import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useAnalyticsQuery,
} from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { ArrowLeft, ArrowRight, ArrowUpRight, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { CohortControls } from '../../components/cohort/CohortControls';
import {
  cohortParameters,
  cohortSearch,
  labelDraftUrl,
  PAGE_SIZE,
  readCohort,
  scopeLabel,
  type Cohort,
} from '../../lib/cohort';
import { formatDate, formatDuration, formatTime } from '../../lib/formatters';

export function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const cohort = useMemo(() => readCohort(searchParams), [searchParams]);
  const parameters = useMemo(() => cohortParameters(cohort), [cohort]);
  const pageParameters = useMemo(
    () => ({ ...parameters, page_size: sql.number(PAGE_SIZE), row_offset: sql.number((cohort.page - 1) * PAGE_SIZE) }),
    [parameters, cohort.page]
  );
  const query = useAnalyticsQuery('explore_interactions', pageParameters);
  const counts = useAnalyticsQuery('explore_count', parameters);
  const reasonParameters = useMemo(
    () => ({ queue: parameters.queue, start_date: parameters.start_date, end_date: parameters.end_date }),
    [parameters]
  );
  const reasonQuery = useAnalyticsQuery('overview_contact_reasons', reasonParameters);
  const countRow = counts.data?.[0];
  const total = countRow ? Number(countRow.total_count) : null;
  const pages = total == null ? null : Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = query.data ?? [];
  const hasFilters = Boolean(
    cohort.q ||
      cohort.reason !== 'all' ||
      cohort.sentiment !== 'all' ||
      cohort.silence !== '0' ||
      cohort.enriched === 'true'
  );
  const reasonOptions = [
    ...new Set([
      ...(reasonQuery.data ?? []).map((row) => row.contact_reason),
      ...(cohort.reason === 'all' ? [] : [cohort.reason]),
    ]),
  ];
  function update(patch: Partial<Cohort>, resetPage = true) {
    setSearchParams(cohortSearch({ ...patch, page: resetPage ? 1 : (patch.page ?? cohort.page) }, cohort).slice(1));
  }
  function callUrl(id: string, seconds: number | null) {
    const params = new URLSearchParams({ from: `${location.pathname}${location.search}` });
    if (seconds != null) params.set('t', String(seconds));
    if (cohort.q) params.set('q', cohort.q);
    return `/calls/${encodeURIComponent(id)}?${params.toString()}`;
  }
  return (
    <div className="ci-explore space-y-5">
      <div className="ci-page-heading flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="ci-eyebrow">INVESTIGATE</p>
          <h2 className="text-3xl font-semibold tracking-tight">Explore conversations</h2>
          <p className="mt-2 text-sm text-muted-foreground">Find the pattern. Open the evidence. Build your case.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline">
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
            Masked transcript search
          </Badge>
          <Button asChild variant="outline">
            <Link to={labelDraftUrl(cohort)}>
              Draft a label from search <ArrowUpRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
      <Card className="ci-filter-panel">
        <CardContent className="space-y-5 pt-6">
          <SearchForm key={cohort.q} initial={cohort.q} onSearch={(q) => update({ q })} />
          <CohortControls prefix="explore" cohort={cohort} onChange={update} />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <FilterSelect
              id="explore-reason"
              label="Contact reason · AI"
              value={cohort.reason}
              onChange={(reason) => update({ reason })}
              options={[
                { value: 'all', label: 'All evaluated reasons' },
                ...reasonOptions.map((reason) => ({ value: reason, label: reason })),
              ]}
            />
            <FilterSelect
              id="explore-sentiment"
              label="Ending sentiment · AI"
              value={cohort.sentiment}
              onChange={(sentiment) => update({ sentiment })}
              options={[
                { value: 'all', label: 'Any sentiment' },
                ...['negative', 'neutral', 'positive'].map((value) => ({ value, label: value })),
              ]}
            />
            <FilterSelect
              id="explore-silence"
              label="Longest silence"
              value={cohort.silence}
              onChange={(silence) => update({ silence })}
              options={[
                { value: '0', label: 'Any silence' },
                ...['5', '10', '20'].map((value) => ({ value, label: `At least ${value} seconds` })),
              ]}
            />
            <FilterSelect
              id="explore-enriched"
              label="Processing scope"
              value={cohort.enriched}
              onChange={(enriched) => update({ enriched })}
              options={[
                { value: 'false', label: 'All calls in scope' },
                { value: 'true', label: 'Enriched sample only' },
              ]}
            />
          </div>
          {hasFilters ? (
            <div className="flex flex-wrap items-center gap-2">
              {cohort.q ? <Badge variant="secondary">Contains “{cohort.q}”</Badge> : null}
              {cohort.reason !== 'all' ? <Badge variant="secondary">{cohort.reason}</Badge> : null}
              {cohort.sentiment !== 'all' ? <Badge variant="secondary">{cohort.sentiment} ending</Badge> : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => update({ q: '', reason: 'all', sentiment: 'all', silence: '0', enriched: 'false' })}
              >
                Clear search filters
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
      {cohort.start && cohort.end && cohort.start > cohort.end ? (
        <QueryError title="Check the recording dates" error="The start date must be on or before the end date." />
      ) : null}
      <div className="ci-scope-note rounded-lg border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        <strong className="text-foreground">{scopeLabel(cohort)}</strong>
        <br />
        {counts.loading
          ? 'Loading cohort coverage…'
          : counts.error
            ? 'Coverage is unavailable while the count query fails.'
            : `${Number(countRow?.scope_count ?? 0).toLocaleString()} calls in this scope · ${Number(countRow?.scope_enriched_count ?? 0).toLocaleString()} successfully enriched.`}{' '}
        Keyword searches use available masked turns only. Calls with missing masked text can be absent from search
        results. AI fields can be unevaluated; verify them against the evidence.
      </div>
      {counts.error ? <QueryError title="The total result count could not load" error={counts.error} /> : null}
      {query.error ? (
        <QueryError title="Conversation search could not load" error={query.error} />
      ) : query.loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Card className="ci-results-panel">
          <CardHeader>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <CardTitle>
                  {total == null ? 'Conversations' : `${total.toLocaleString()} matching conversations`}
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Newest first · stable server pagination · {PAGE_SIZE} calls per page
                </p>
              </div>
              {countRow ? (
                <span className="text-xs text-muted-foreground">
                  {Number(countRow.enriched_count).toLocaleString()} enriched ·{' '}
                  {Number(countRow.masked_complete_count).toLocaleString()} with masked text for every turn
                </span>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {!rows.length ? (
              <Empty>
                <EmptyTitle>
                  {total && total > 0
                    ? 'This page is outside the matching results'
                    : 'No conversations match these filters'}
                </EmptyTitle>
                <EmptyDescription>
                  {total && total > 0
                    ? 'Return to the first page to review the current cohort.'
                    : 'Try a shorter phrase, widen the recording dates, or clear a filter. Search excludes turns without masked text.'}
                </EmptyDescription>
                <Button
                  variant="outline"
                  onClick={() => (total && total > 0 ? update({ page: 1 }, false) : setSearchParams({}))}
                >
                  {total && total > 0 ? 'First page' : 'Reset search'}
                </Button>
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <Table className="ci-results-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Conversation & evidence</TableHead>
                      <TableHead>Queue / reason</TableHead>
                      <TableHead>End sentiment</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Processing</TableHead>
                      <TableHead>
                        <span className="sr-only">Review conversation</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.interaction_id}>
                        <TableCell className="min-w-80 max-w-lg align-top">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <Link
                              className="font-semibold text-primary hover:underline"
                              to={callUrl(row.interaction_id, row.match_start_seconds)}
                            >
                              {row.interaction_id}
                            </Link>
                            <span className="text-xs text-muted-foreground">{formatDate(row.started_at)}</span>
                          </div>
                          <p className="mt-2 max-w-lg whitespace-normal text-sm leading-relaxed">
                            {row.matched_text ? (
                              highlight(row.matched_text, cohort.q)
                            ) : (
                              <span className="text-muted-foreground">
                                Masked transcript not available. Raw text is withheld.
                              </span>
                            )}
                          </p>
                          {row.matched_text && row.match_start_seconds != null ? (
                            <Link
                              className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              to={callUrl(row.interaction_id, row.match_start_seconds)}
                            >
                              <ArrowUpRight className="h-3 w-3" />
                              {formatTime(row.match_start_seconds)} ·{' '}
                              {cohort.q ? 'Open matching turn' : 'Open first masked turn'}
                            </Link>
                          ) : null}
                        </TableCell>
                        <TableCell className="align-top">
                          <span className="font-medium">{row.queue}</span>
                          <span className="mt-1 block text-xs capitalize text-muted-foreground">
                            {row.contact_reason || 'Not evaluated'}
                          </span>
                          <span className="mt-2 block text-xs text-muted-foreground">{row.agent_name}</span>
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge
                            variant={row.sentiment_end === 'negative' ? 'destructive' : 'secondary'}
                            className="capitalize"
                          >
                            {row.sentiment_end || 'Not evaluated'}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap align-top tabular-nums">
                          {formatDuration(row.duration_seconds)}
                        </TableCell>
                        <TableCell className="align-top">
                          <span className="text-xs">
                            {row.is_enriched
                              ? 'Enriched'
                              : row.enrichment_status === 'failed'
                                ? 'Enrichment failed'
                                : 'Not evaluated'}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">Masking: {row.masking_state}</span>
                        </TableCell>
                        <TableCell className="align-top">
                          <Button variant="ghost" size="icon" asChild>
                            <Link
                              to={callUrl(row.interaction_id, row.match_start_seconds)}
                              aria-label={`Review conversation ${row.interaction_id}`}
                            >
                              <ArrowUpRight className="h-4 w-4" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {rows.length
                  ? `Showing ${((cohort.page - 1) * PAGE_SIZE + 1).toLocaleString()}–${((cohort.page - 1) * PAGE_SIZE + rows.length).toLocaleString()}${total == null ? ' · total unavailable' : ` of ${total.toLocaleString()}`}`
                  : 'No rows on this page'}
              </span>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cohort.page <= 1 || query.loading}
                  onClick={() => update({ page: cohort.page - 1 }, false)}
                >
                  <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                  Previous
                </Button>
                <span className="text-xs tabular-nums">
                  Page {cohort.page}
                  {pages == null ? '' : ` of ${pages}`}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={query.loading || (total == null ? rows.length < PAGE_SIZE : cohort.page >= (pages ?? 1))}
                  onClick={() => update({ page: cohort.page + 1 }, false)}
                >
                  Next
                  <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
function SearchForm({ initial, onSearch }: { initial: string; onSearch: (value: string) => void }) {
  const [draft, setDraft] = useState(initial);
  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch(draft.trim());
  }
  return (
    <form onSubmit={submit}>
      <label className="mb-2 block text-sm font-medium" htmlFor="transcript-keyword">
        Search the masked transcript
      </label>
      <div className="flex gap-2">
        <Input
          id="transcript-keyword"
          type="search"
          maxLength={250}
          placeholder="A word or exact phrase, e.g. balance"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit">
          <Search className="mr-2 h-4 w-4" />
          Search
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Literal phrase search. Search text and all filters are preserved in the page link.
      </p>
    </form>
  );
}
function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">
        {label}
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function QueryError({ title, error }: { title: string; error: unknown }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{String(error)}</AlertDescription>
    </Alert>
  );
}
function highlight(text: string, keyword: string) {
  const index = keyword ? text.toLowerCase().indexOf(keyword.toLowerCase()) : -1;
  return index < 0 ? (
    text
  ) : (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-primary/20 px-0.5 text-foreground">{text.slice(index, index + keyword.length)}</mark>
      {text.slice(index + keyword.length)}
    </>
  );
}
