/**
 * Response shapes shared by the insights API and both client data sources
 * (live warehouse data and offline fixtures). Dates are YYYY-MM-DD; '' means unbounded.
 */
export type Scope = { queue: string; start: string; end: string };
/** Overview cross-filter. Empty strings mean no filter. */
export type Focus = { reason: string; theme: string };
export const NO_FOCUS: Focus = { reason: '', theme: '' };

export type Bounds = {
  minDate: string;
  maxDate: string;
  calls: number;
  recordingDays: number;
  queues: string[];
};

export type Sentiment = 'negative' | 'neutral' | 'positive';

export type OverviewData = {
  periodStart: string;
  periodEnd: string;
  previousStart: string;
  calls: number;
  previousCalls: number;
  agents: number;
  enriched: number;
  avgDurationSeconds: number | null;
  previousAvgDurationSeconds: number | null;
  sentimentEvaluated: number;
  previousSentimentEvaluated: number;
  negativeShare: number | null;
  previousNegativeShare: number | null;
  repeatEvaluated: number;
  previousRepeatEvaluated: number;
  repeatShare: number | null;
  previousRepeatShare: number | null;
  latestProcessedAt: string | null;
  daily: { date: string; calls: number; negativeShare: number | null }[];
  reasons: { name: string; calls: number; avgDurationSeconds: number | null; negative: number }[];
};

export type ChangeKind = 'reason' | 'theme' | 'label';
export type Change = {
  kind: ChangeKind;
  id: string;
  name: string;
  current: number;
  previous: number;
  currentShare: number;
  previousShare: number;
  /** Relative change in share of evaluated calls, e.g. 0.4 = +40%. */
  changePct: number;
  currentAvgDurationSeconds: number | null;
  previousAvgDurationSeconds: number | null;
  topQueue: string | null;
  topQueueShare: number | null;
};
export type ChangesData = {
  /** False when the previous equal-length period has no calls, so no change can be measured. */
  comparable: boolean;
  previousStart: string;
  previousCalls: number;
  threshold: number;
  minCalls: number;
  changes: Change[];
};

export type ExploreFilters = {
  q: string;
  reason: string;
  sentiment: Sentiment | '';
  theme: string;
  silence: boolean;
  page: number;
};
export type ExploreRow = {
  id: string;
  startedAt: string;
  queue: string;
  agentName: string;
  durationSeconds: number;
  longestSilenceSeconds: number | null;
  contactReason: string | null;
  sentimentEnd: string | null;
  resolution: string | null;
  enrichment: 'complete' | 'pending' | 'failed';
  masking: 'complete' | 'partial' | 'pending';
  matchText: string | null;
  matchStart: number | null;
};
export type ExploreData = {
  rows: ExploreRow[];
  total: number;
  scopeTotal: number;
  scopeEnriched: number;
  maskedComplete: number;
  pageSize: number;
  latestProcessedAt: string | null;
};

export type CallSegment = { idx: number; start: number; end: number; role: string; text: string | null };
export type KeyMoment = { label: string; start: number; quote: string | null; grounded: boolean };
export type CallDetail = {
  id: string;
  startedAt: string;
  durationSeconds: number;
  queue: string;
  agentName: string;
  enriched: boolean;
  summary: string | null;
  contactReason: string | null;
  sentimentStart: string | null;
  sentimentEnd: string | null;
  resolution: string | null;
  repeatContactMentioned: boolean | null;
  transferCount: number | null;
  talkRatioAgent: number | null;
  longestSilenceSeconds: number | null;
  overtalkCount: number | null;
  holdCount: number | null;
  themes: { id: string; name: string }[];
  segments: CallSegment[];
  moments: KeyMoment[];
  /** True when original audio can be requested from /api/calls/:id/audio. */
  audio: boolean;
};

export type ThemeRun = { id: string; createdAt: string; method: string; callsThemed: number; purity: number | null };
export type ThemeSummary = {
  id: string;
  name: string;
  description: string;
  calls: number;
  previousCalls: number;
  avgDurationSeconds: number | null;
  negative: number;
  sentimentEvaluated: number;
  repeatMentions: number;
  repeatEvaluated: number;
  topQueue: string | null;
};
export type ThemesData = {
  run: ThemeRun | null;
  callsInScope: number;
  themedInScope: number;
  themes: ThemeSummary[];
};
export type ThemeRepresentative = {
  id: string;
  startedAt: string;
  queue: string;
  durationSeconds: number;
  sentimentEnd: string | null;
  excerpt: string | null;
  excerptStart: number | null;
};
export type ThemeDetail = {
  run: ThemeRun;
  callsInScope: number;
  theme: ThemeSummary;
  byQueue: { queue: string; calls: number; avgDurationSeconds: number | null }[];
  reasons: { name: string; calls: number }[];
  daily: { date: string; calls: number }[];
  representatives: ThemeRepresentative[];
};

export type ThemeMapPoint = {
  id: string;
  theme: string;
  x: number;
  y: number;
  queue: string;
  day: string;
  durationSeconds: number;
  sentimentEnd: string | null;
};
export type ThemeMapData = { points: ThemeMapPoint[]; truncated: boolean };

export type TrackingPoint = { date: string; evaluated: number; matched: number };
export type LabelTracking = {
  enabled: boolean;
  version: number | null;
  enabledAt: string | null;
  lastRunAt: string | null;
  points: TrackingPoint[];
};

export type DataMode = 'live' | 'fixtures';
