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
  LineChart,
  Skeleton,
  useAnalyticsQuery,
} from '@databricks/appkit-ui/react';
import { ArrowDownRight, ArrowUpRight, AudioLines, Frown, MessagesSquare, Repeat, Timer } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CohortControls } from '../../components/cohort/CohortControls';
import { cohortSearch, metricChange, readCohort, scopeLabel, scopeParameters } from '../../lib/cohort';
import { formatDate, formatDuration, formatPercent } from '../../lib/formatters';

export function OverviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const cohort = useMemo(() => readCohort(searchParams), [searchParams]);
  const parameters = useMemo(() => scopeParameters(cohort), [cohort]);
  const bounds = useAnalyticsQuery('dataset_bounds', {});
  const summary = useAnalyticsQuery('overview_summary', parameters);
  const reasons = useAnalyticsQuery('overview_contact_reasons', parameters);
  const volume = useAnalyticsQuery('daily_activity', parameters);
  const row = summary.data?.[0];
  const enrichedCount = Number(row?.enriched_count ?? 0);
  const total = Number(row?.interaction_count ?? 0);
  const topReason = reasons.data?.[0];
  const exploreUrl = `/explore${cohortSearch({ queue: cohort.queue, start: cohort.start, end: cohort.end })}`;
  const reasonUrl = (reason: string) =>
    `/explore${cohortSearch({ queue: cohort.queue, start: cohort.start, end: cohort.end, reason, enriched: 'true' })}`;

  return (
    <div className="ci-overview space-y-6">
      <div className="ci-page-heading flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="ci-eyebrow">THE BIG PICTURE</p>
          <h2 className="text-3xl font-semibold tracking-tight">Every conversation. A clearer picture.</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Find a pattern worth investigating, then follow it to the evidence.
          </p>
        </div>
        <CohortControls
          prefix="overview"
          cohort={cohort}
          onChange={(patch) => setSearchParams(cohortSearch(patch, cohort).slice(1), { replace: true })}
        />
      </div>

      <div className="ci-scope-note flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <AudioLines className="h-4 w-4 text-primary" />
          <strong className="text-foreground">Warehouse data</strong>
        </span>
        <span>{scopeLabel(cohort)}</span>
        {bounds.error ? (
          <span>Dataset dates unavailable</span>
        ) : bounds.loading ? (
          <Skeleton className="h-4 w-48" />
        ) : (
          <span>
            Available: {bounds.data?.[0]?.min_started_at ? formatDate(bounds.data[0].min_started_at) : '—'} –{' '}
            {bounds.data?.[0]?.max_started_at ? formatDate(bounds.data[0].max_started_at) : '—'}
          </span>
        )}
      </div>
      {cohort.start && cohort.end && cohort.start > cohort.end ? (
        <QueryError title="Check the recording dates" error="The start date must be on or before the end date." />
      ) : null}

      {summary.error ? (
        <QueryError title="Overview metrics could not load" error={summary.error} />
      ) : summary.loading || !row ? (
        <div className="ci-kpi-grid grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton className="h-36" key={index} />
          ))}
        </div>
      ) : total === 0 ? (
        <Empty>
          <EmptyTitle>No calls in this scope</EmptyTitle>
          <EmptyDescription>Choose a different queue or widen the recording dates.</EmptyDescription>
          <Button variant="outline" onClick={() => setSearchParams({})}>
            Reset scope
          </Button>
        </Empty>
      ) : (
        <div className="ci-kpi-grid grid gap-4 md:grid-cols-4">
          <MetricCard
            icon={<MessagesSquare className="h-4 w-4" />}
            label="Conversations"
            value={total.toLocaleString()}
            detail="All calls in the selected recording period"
            comparison={metricChange(total, row.previous_interaction_count, 'percent')}
            href={exploreUrl}
          />
          <MetricCard
            icon={<Timer className="h-4 w-4" />}
            label="Average call duration"
            value={row.avg_duration_seconds == null ? '—' : formatDuration(row.avg_duration_seconds)}
            detail="Recording length · excludes after-call work"
            comparison={metricChange(
              row.avg_duration_seconds,
              row.previous_interaction_count > 0 ? row.previous_avg_duration_seconds : null,
              'seconds'
            )}
            href={exploreUrl}
          />
          <MetricCard
            icon={<Frown className="h-4 w-4" />}
            label="Negative end sentiment"
            value={row.negative_share == null ? '—' : formatPercent(row.negative_share, 1)}
            detail={`AI evaluated ${Number(row.sentiment_count).toLocaleString()} calls · verify evidence`}
            comparison={metricChange(
              row.negative_share,
              row.previous_sentiment_count > 0 ? row.previous_negative_share : null,
              'points'
            )}
            href={`/explore${cohortSearch({ queue: cohort.queue, start: cohort.start, end: cohort.end, sentiment: 'negative' })}`}
          />
          <MetricCard
            icon={<Repeat className="h-4 w-4" />}
            label="Previous contact mentioned"
            value={row.repeat_share == null ? '—' : formatPercent(row.repeat_share, 1)}
            detail={`AI evaluated ${Number(row.repeat_evaluated_count).toLocaleString()} calls · mention, not a repeat rate`}
            comparison={metricChange(
              row.repeat_share,
              row.previous_repeat_evaluated_count > 0 ? row.previous_repeat_share : null,
              'points'
            )}
          />
        </div>
      )}

      {row && total > 0 ? (
        <p className="text-xs text-muted-foreground">
          {enrichedCount.toLocaleString()} of {total.toLocaleString()} calls enriched (
          {formatPercent(enrichedCount / total, 1)}). AI metrics cover evaluated calls only.{' '}
          {row.latest_processed_at
            ? `Latest enrichment: ${formatDate(row.latest_processed_at)}.`
            : 'No successful enrichment in scope.'}{' '}
          {row.previous_period_start && row.period_start
            ? `Previous equal period starts ${String(row.previous_period_start).slice(0, 10)} and ends before ${String(row.period_start).slice(0, 10)} UTC. No observations means no measured comparison.`
            : 'Recording-window bounds unavailable.'}{' '}
          Prior period: {Number(row.previous_interaction_count).toLocaleString()} calls; sentiment evaluated on{' '}
          {Number(row.previous_sentiment_count).toLocaleString()}, previous-contact mentions evaluated on{' '}
          {Number(row.previous_repeat_evaluated_count).toLocaleString()}. AI sample coverage can differ between periods.
        </p>
      ) : null}

      <Card className="ci-priority-panel overflow-hidden">
        <CardContent className="grid gap-6 pt-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <Badge variant="outline" className="mb-4">
              START AN INVESTIGATION
            </Badge>
            <h3 className="text-2xl font-semibold">
              {topReason ? `Start with ${topReason.contact_reason}` : 'A finding starts with a conversation.'}
            </h3>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {topReason
                ? `${Number(topReason.interaction_count).toLocaleString()} enriched calls have this contact reason, the most common in the selected scope. Review the conversations before drawing a conclusion.`
                : 'Search the recordings, verify a relevant moment, and save timestamped evidence to an investigation.'}
            </p>
          </div>
          <Button asChild>
            <Link to={topReason ? reasonUrl(topReason.contact_reason) : exploreUrl}>
              Review conversations <ArrowUpRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <Card className="ci-contact-reasons">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>What are customers calling about?</CardTitle>
              <ArrowDownRight className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">
              AI contact reasons · enriched calls only · select a reason to investigate
            </p>
          </CardHeader>
          <CardContent>
            {reasons.error ? (
              <QueryError title="Contact reasons could not load" error={reasons.error} />
            ) : reasons.loading ? (
              <Skeleton className="h-72" />
            ) : !reasons.data?.length ? (
              <Empty>
                <EmptyTitle>No evaluated contact reasons</EmptyTitle>
                <EmptyDescription>Browse the available calls while enrichment is pending.</EmptyDescription>
                <Button asChild variant="outline">
                  <Link to={exploreUrl}>Explore calls</Link>
                </Button>
              </Empty>
            ) : (
              <div className="divide-y">
                {reasons.data.map((reason) => {
                  const share = enrichedCount ? Number(reason.interaction_count) / enrichedCount : 0;
                  return (
                    <Link
                      key={reason.contact_reason}
                      to={reasonUrl(reason.contact_reason)}
                      className="ci-reason-row group grid grid-cols-[1fr_auto] gap-4 py-4 hover:text-primary"
                    >
                      <div>
                        <div className="text-sm font-medium capitalize">{reason.contact_reason}</div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.min(100, share * 100)}%` }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-right">
                        <span>
                          <strong className="text-sm tabular-nums">
                            {Number(reason.interaction_count).toLocaleString()}
                          </strong>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {formatPercent(share, 1)} of enriched
                          </span>
                        </span>
                        <ArrowUpRight className="h-4 w-4" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Conversations over time</CardTitle>
            <p className="text-xs text-muted-foreground">
              Calls per UTC recording day · includes calls without enrichment. Dates without recordings are unobserved.
            </p>
          </CardHeader>
          <CardContent>
            {volume.error ? (
              <QueryError title="Call volume could not load" error={volume.error} />
            ) : volume.loading ? (
              <Skeleton className="h-72" />
            ) : !volume.data?.length ? (
              <Empty>
                <EmptyTitle>No call volume in scope</EmptyTitle>
                <EmptyDescription>Widen the recording dates to see the available conversations.</EmptyDescription>
              </Empty>
            ) : (
              <>
                <LineChart
                  data={volume.data}
                  xKey="day"
                  yKey="interaction_count"
                  colorPalette="sequential"
                  ariaLabel="Actual calls per UTC day in the selected scope"
                  height={220}
                  showSymbol={false}
                />
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-xs">
                    <caption className="mb-2 text-left text-muted-foreground">
                      Daily negative ending sentiment · evaluated calls only
                    </caption>
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="py-2 text-left font-medium">UTC day</th>
                        <th className="py-2 text-right font-medium">Calls</th>
                        <th className="py-2 text-right font-medium">Negative / evaluated</th>
                        <th className="py-2 text-right font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {volume.data.map((day) => {
                        const date = String(day.day).slice(0, 10);
                        return (
                          <tr key={day.day} className="border-b">
                            <td className="py-2">
                              <Link
                                className="text-primary hover:underline"
                                to={`/explore${cohortSearch({ queue: cohort.queue, start: date, end: date })}`}
                              >
                                {date}
                              </Link>
                            </td>
                            <td className="py-2 text-right tabular-nums">
                              {Number(day.interaction_count).toLocaleString()}
                            </td>
                            <td className="py-2 text-right tabular-nums">
                              {Number(day.negative_count)} / {Number(day.sentiment_count)}
                            </td>
                            <td className="py-2 text-right tabular-nums">
                              {day.negative_share == null ? 'Not evaluated' : formatPercent(day.negative_share, 1)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 rounded-lg border p-5 text-sm sm:grid-cols-3">
        <p>
          <strong>01 · Find a pattern</strong>
          <span className="mt-1 block text-muted-foreground">Select a reason or search the masked transcript.</span>
        </p>
        <p>
          <strong>02 · Verify the moment</strong>
          <span className="mt-1 block text-muted-foreground">Open a call at the matching timestamp.</span>
        </p>
        <p>
          <strong>03 · Build the case</strong>
          <span className="mt-1 block text-muted-foreground">
            Save an excerpt and your interpretation to an investigation.
          </span>
        </p>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  href,
  comparison,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  href?: string;
  comparison?: string;
}) {
  return (
    <Card className="ci-kpi">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-tight tabular-nums">
          {href ? (
            <Link to={href} className="hover:text-primary">
              {value}
            </Link>
          ) : (
            value
          )}
        </div>
        {comparison ? <p className="mt-2 text-xs leading-relaxed">{comparison}</p> : null}
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
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
