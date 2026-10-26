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
  Input,
  Skeleton,
  useAnalyticsQuery,
} from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { ArrowLeft, Bookmark, Headphones, Link2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { EvidenceSaveDialog } from '../investigations/EvidenceSaveDialog';
import { formatDate, formatDuration, formatPercent, formatTime } from '../../lib/formatters';
import { evidenceReturnPath, evidenceTime } from '../../lib/evidence';

type Segment = {
  segment_idx: number;
  start_seconds: number;
  end_seconds: number;
  speaker_role: string;
  text: string | null;
  is_masked: boolean;
};

export function CallDetailPage() {
  const { interactionId = '' } = useParams();
  return <CallDetail key={interactionId} interactionId={interactionId} />;
}
function CallDetail({ interactionId }: { interactionId: string }) {
  const [params, setParams] = useSearchParams();
  const initialTime = evidenceTime(params.get('t'));
  const parameters = useMemo(() => ({ interaction_id: sql.string(interactionId) }), [interactionId]);
  const detail = useAnalyticsQuery('call_detail', parameters);
  const segments = useAnalyticsQuery('call_segments', parameters);
  const moments = useAnalyticsQuery('call_key_moments', parameters);
  const audio = useRef<HTMLAudioElement>(null);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [time, setTime] = useState(initialTime);
  const [rangeStart, setRangeStart] = useState(initialTime);
  const [rangeEnd, setRangeEnd] = useState(initialTime + 20);
  const [audioError, setAudioError] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (audio.current && Math.abs(audio.current.currentTime - initialTime) > 0.2)
      audio.current.currentTime = initialTime;
  }, [initialTime]);
  const returnTo = evidenceReturnPath(params.get('from'));
  const call = detail.data?.[0];
  const allSegments: Segment[] = segments.data ?? [];
  const duration = Math.max(0, Number(call?.duration_seconds) || 0);
  const start = Math.min(Math.max(0, rangeStart), duration);
  const end = Math.min(Math.max(0, rangeEnd), duration);
  const selectedSegments = allSegments.filter((s) => s.end_seconds > start && s.start_seconds < end);
  const safeSelection =
    end > start && selectedSegments.length > 0 && selectedSegments.every((s) => s.is_masked && s.text?.trim());
  const excerpt = safeSelection ? selectedSegments.map((s) => s.text).join(' ') : '';
  function stamp(nextTime: number) {
    const next = new URLSearchParams(params);
    next.set('t', String(Math.round(nextTime * 10) / 10));
    setParams(next, { replace: true });
  }
  function seek(nextTime: number, segment?: Segment) {
    const next = Math.min(duration, Math.max(0, nextTime));
    setTime(next);
    stamp(next);
    if (audio.current) audio.current.currentTime = next;
    if (segment) {
      setRangeStart(segment.start_seconds);
      setRangeEnd(segment.end_seconds);
    }
  }
  async function copyLink() {
    const url = new URL(window.location.href);
    url.searchParams.set('t', String(Math.round(time * 10) / 10));
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  if (detail.error || segments.error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Conversation unavailable</AlertTitle>
        <AlertDescription>
          Check your source permissions or warehouse availability, then reload.{' '}
          <Link to={returnTo} className="underline">
            Return to your previous view
          </Link>
        </AlertDescription>
      </Alert>
    );
  if (detail.loading || segments.loading) return <Skeleton className="h-[640px] w-full" />;
  if (!call)
    return (
      <Card>
        <CardContent className="p-8">
          <h2 className="text-xl font-semibold">Conversation unavailable</h2>
          <p className="my-3 text-muted-foreground">It may have been removed or your source access may have changed.</p>
          <Link to={returnTo} className="text-primary underline">
            Return to your previous view
          </Link>
        </CardContent>
      </Card>
    );

  const maskedCount = allSegments.filter((s) => s.is_masked && s.text?.trim()).length;
  const transcript = allSegments.filter(
    (s) => !search.trim() || s.text?.toLowerCase().includes(search.trim().toLowerCase())
  );
  const active = allSegments.find((s) => time >= s.start_seconds && time < s.end_seconds);
  const keyMoments = moments.data ?? [];
  return (
    <div className="space-y-6">
      <Link
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        to={returnTo}
      >
        <ArrowLeft size={15} />
        Back to{' '}
        {returnTo.startsWith('/cases')
          ? 'investigation'
          : returnTo.startsWith('/labels')
            ? 'label results'
            : returnTo.startsWith('/ask')
              ? 'Ask'
              : 'Explore calls'}
      </Link>
      <div className="ci-page-heading">
        <div>
          <p className="ci-eyebrow">CONVERSATION EVIDENCE</p>
          <h1>Call {call.interaction_id}</h1>
          <p>
            {formatDate(call.started_at)} · {formatDuration(duration)} · {call.queue} ·{' '}
            {call.agent_name || 'Agent unavailable'}
          </p>
        </div>
        <Badge variant="outline">{call.transcription_status}</Badge>
      </div>

      <section className="ci-audio-player" aria-label="Original call recording">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <Headphones size={18} />
              Original call audio
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The recording may contain personal information. Playback uses your source permissions.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void copyLink()}>
            <Link2 size={14} />
            {copied ? 'Link copied' : 'Copy timestamp link'}
          </Button>
        </div>
        <audio
          ref={audio}
          key={interactionId}
          className="mt-3 w-full"
          controls
          preload="metadata"
          src={`/api/calls/${encodeURIComponent(interactionId)}/audio`}
          onError={() => setAudioError(true)}
          onLoadedMetadata={() => {
            if (audio.current) audio.current.currentTime = Math.min(initialTime, audio.current.duration || duration);
          }}
          onSeeked={() => {
            if (audio.current) setTime(audio.current.currentTime);
          }}
          onTimeUpdate={() => {
            if (audio.current) setTime(audio.current.currentTime);
          }}
          onPause={() => {
            if (audio.current) stamp(audio.current.currentTime);
          }}
          aria-label="Play original call recording"
        />
        <div className="mt-2 flex items-center justify-between gap-3 text-xs">
          <span className="tabular-nums text-muted-foreground">
            {formatTime(time)} / {formatTime(duration)} ·{' '}
            {active?.speaker_role === 'agent'
              ? 'Agent speaking'
              : active
                ? 'Customer speaking'
                : 'Silence / between turns'}
          </span>
          <label className="flex items-center gap-2">
            Speed
            <select
              className="rounded border bg-background px-2 py-1"
              defaultValue="1"
              onChange={(e) => {
                if (audio.current) audio.current.playbackRate = Number(e.target.value);
              }}
            >
              {[0.75, 1, 1.25, 1.5, 2].map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </select>
          </label>
        </div>
        {audioError && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            Original audio could not be loaded. Check your volume permissions or try again.
          </p>
        )}
      </section>

      <div className="ci-detail-grid">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Speaker timeline</CardTitle>
              <p className="text-xs text-muted-foreground">
                Select a turn to seek the recording and choose its evidence range.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {['agent', 'customer'].map((role) => (
                <TimelineLane
                  key={role}
                  label={role === 'agent' ? 'Agent' : 'Customer'}
                  role={role}
                  duration={duration}
                  segments={allSegments}
                  time={time}
                  onSelect={(segment) => seek(segment.start_seconds, segment)}
                />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Transcript</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {maskedCount} of {allSegments.length} turns masked. Unmasked text is withheld.
                  </p>
                </div>
                <Input
                  className="max-w-xs"
                  aria-label="Search masked transcript"
                  placeholder="Find words in this call…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent>
              {!allSegments.length ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Transcript is not available yet.</p>
              ) : !transcript.length ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No masked turns match “{search}”.</p>
              ) : (
                <ol className="ci-transcript">
                  {transcript.map((segment) => (
                    <li key={segment.segment_idx} data-active={active?.segment_idx === segment.segment_idx}>
                      <button
                        type="button"
                        onClick={() => seek(segment.start_seconds, segment)}
                        aria-label={`Seek ${segment.speaker_role} at ${formatTime(segment.start_seconds)}`}
                      >
                        <span className="ci-turn-time">{formatTime(segment.start_seconds)}</span>
                        <span className={`ci-turn-role ci-turn-${segment.speaker_role}`}>
                          {segment.speaker_role === 'agent' ? 'Agent' : 'Customer'}
                        </span>
                        <span>
                          {segment.is_masked && segment.text ? (
                            <HighlightedText text={segment.text} search={search} />
                          ) : (
                            <em className="text-muted-foreground">Text withheld · masking pending</em>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
        <aside className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bookmark size={16} />
                Build your investigation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Choose a timestamp range and save the source with your analysis.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-xs">
                  Start (seconds)
                  <Input
                    type="number"
                    min="0"
                    max={duration}
                    step="0.1"
                    value={rangeStart}
                    onChange={(e) => setRangeStart(Number(e.target.value))}
                  />
                </label>
                <label className="space-y-1 text-xs">
                  End (seconds)
                  <Input
                    type="number"
                    min="0"
                    max={duration}
                    step="0.1"
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(Number(e.target.value))}
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatTime(start)}–{formatTime(end)}
              </p>
              {safeSelection ? (
                <EvidenceSaveDialog interactionId={interactionId} start={start} end={end} excerpt={excerpt} />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Select a range containing fully masked transcript turns to save evidence.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>AI call summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {call.is_enriched ? (
                <>
                  <Badge variant="outline">AI generated · verify with source</Badge>
                  <h3 className="font-medium">{call.topic_phrase || call.contact_reason || 'Conversation summary'}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {call.summary || 'No summary returned.'}
                  </p>
                  <p className="text-xs text-muted-foreground">Model: {call.model_endpoint || 'Not recorded'}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This call has not been enriched. Summary, sentiment, and resolution are unavailable.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Key moments</CardTitle>
            </CardHeader>
            <CardContent>
              {moments.error ? (
                <p className="text-sm text-destructive">Key moments could not be loaded.</p>
              ) : moments.loading ? (
                <Skeleton className="h-24" />
              ) : !keyMoments.length ? (
                <p className="text-sm text-muted-foreground">No AI key moments available.</p>
              ) : (
                <ol className="space-y-3">
                  {keyMoments.map((moment) => (
                    <li key={`${moment.label}-${moment.start_seconds}`} className="rounded-md border p-3">
                      <button
                        className="flex w-full items-start justify-between gap-3 text-left text-sm"
                        type="button"
                        onClick={() => seek(Number(moment.start_seconds))}
                      >
                        <span className="font-medium">{moment.label}</span>
                        <span className="tabular-nums text-primary">{formatTime(moment.start_seconds)}</span>
                      </button>
                      {moment.grounded && moment.quote ? (
                        <p className="mt-2 text-sm text-muted-foreground">“{moment.quote}”</p>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Quote withheld: not verified in the masked transcript.
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Call metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 text-sm">
                <dt className="text-muted-foreground">Contact reason</dt>
                <dd>{call.contact_reason || 'Not evaluated'}</dd>
                <dt className="text-muted-foreground">Closing sentiment</dt>
                <dd className="capitalize">{call.sentiment_end || 'Not evaluated'}</dd>
                <dt className="text-muted-foreground">Resolution</dt>
                <dd>{call.resolution_status || 'Not evaluated'}</dd>
                <dt className="text-muted-foreground">Repeat mentioned</dt>
                <dd>
                  {call.repeat_contact_mentioned == null
                    ? 'Not evaluated'
                    : call.repeat_contact_mentioned
                      ? 'Yes'
                      : 'No'}
                </dd>
                <dt className="text-muted-foreground">Agent talk ratio</dt>
                <dd>{call.talk_ratio_agent == null ? 'Unavailable' : formatPercent(call.talk_ratio_agent)}</dd>
                <dt className="text-muted-foreground">Longest silence</dt>
                <dd>
                  {call.longest_silence_seconds == null
                    ? 'Unavailable'
                    : `${Number(call.longest_silence_seconds).toFixed(1)}s`}
                </dd>
              </dl>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
function HighlightedText({ text, search }: { text: string; search: string }) {
  const term = search.trim();
  if (!term) return text;
  const parts: ReactNode[] = [];
  let offset = 0;
  let match = text.toLowerCase().indexOf(term.toLowerCase());
  while (match !== -1) {
    parts.push(text.slice(offset, match), <mark key={match}>{text.slice(match, match + term.length)}</mark>);
    offset = match + term.length;
    match = text.toLowerCase().indexOf(term.toLowerCase(), offset);
  }
  parts.push(text.slice(offset));
  return <>{parts}</>;
}
function TimelineLane({
  label,
  role,
  duration,
  segments,
  time,
  onSelect,
}: {
  label: string;
  role: string;
  duration: number;
  segments: Segment[];
  time: number;
  onSelect: (segment: Segment) => void;
}) {
  return (
    <div className="ci-timeline-lane">
      <span>{label}</span>
      <div className="ci-timeline-track">
        {duration > 0 &&
          segments
            .filter((s) => s.speaker_role === role)
            .map((segment) => (
              <button
                key={segment.segment_idx}
                className={`ci-timeline-segment ci-timeline-${role}`}
                style={{
                  left: `${(segment.start_seconds / duration) * 100}%`,
                  width: `${Math.max(0.5, ((segment.end_seconds - segment.start_seconds) / duration) * 100)}%`,
                }}
                onClick={() => onSelect(segment)}
                type="button"
                aria-label={`${label} at ${formatTime(segment.start_seconds)}`}
                title={`${formatTime(segment.start_seconds)}–${formatTime(segment.end_seconds)}`}
              />
            ))}
        <span
          className="ci-timeline-playhead"
          style={{ left: `${duration ? Math.min((time / duration) * 100, 100) : 0}%` }}
        />
      </div>
    </div>
  );
}
