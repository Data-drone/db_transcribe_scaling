import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  Bounds,
  CallDetail,
  ChangesData,
  DataMode,
  ExploreData,
  ExploreFilters,
  LabelTracking,
  OverviewData,
  Scope,
  ThemeDetail,
  ThemesData,
} from '../../../shared/insights';
import type {
  EvidenceInput,
  Investigation,
  InvestigationSummary,
} from '../../../shared/investigations';
import type { IntelligenceLabel, LabelInput, LabelResult, LabelRun, RunEstimate } from '../../../shared/intelligence';

export type LabelSummaryRow = {
  label_id: string;
  version: number;
  run_type: string;
  status: string;
  started_at: string;
  interactions_in_scope: number;
  matched_count: number;
  reviewed_count: number;
  correct_count: number;
};
export type TrackingStatusRow = { label_id: string; version: number; enabled: boolean | string; enabled_at: string; last_run_at: string };
export type BreakdownRow = { dimension: string; value: string; evaluated_count: number; matched_count: number; error_count: number };
export type RunResults = { results: LabelResult[]; breakdown: BreakdownRow[]; pageSize: number };

export interface CaseApi {
  list(): Promise<InvestigationSummary[]>;
  get(id: string): Promise<Investigation>;
  create(title: string, question?: string): Promise<Investigation>;
  update(id: string, input: { title: string; question: string; version: number }): Promise<Investigation>;
  addItem(id: string, item: EvidenceInput, version: number): Promise<Investigation>;
  share(id: string, emails: string[], version: number): Promise<Investigation>;
  /** Markdown brief for download. */
  brief(id: string): Promise<{ filename: string; markdown: string }>;
}

export interface LabelApi {
  list(): Promise<IntelligenceLabel[]>;
  summary(): Promise<{ latest: LabelSummaryRow[]; tracking: TrackingStatusRow[] }>;
  create(input: LabelInput): Promise<IntelligenceLabel>;
  update(id: string, input: LabelInput): Promise<IntelligenceLabel>;
  runs(id: string): Promise<LabelRun[]>;
  sample(id: string, version: number): Promise<{ runId: string; count: number }>;
  estimate(id: string, version: number): Promise<RunEstimate>;
  full(id: string, version: number, cohortId: string): Promise<{ runId: string; count: number }>;
  results(runId: string, page: number): Promise<RunResults>;
  feedback(runId: string, interactionId: string, verdict: 'correct' | 'incorrect'): Promise<void>;
  tracking(id: string): Promise<LabelTracking>;
  setTracking(id: string, version: number, enabled: boolean): Promise<LabelTracking>;
}

export interface DataSource {
  mode: DataMode;
  /** Short human description of where data comes from, shown in the scope strip. */
  describe: string;
  identity(): Promise<{ email: string | null; name: string | null }>;
  bounds(): Promise<Bounds>;
  overview(scope: Scope): Promise<OverviewData>;
  changes(scope: Scope): Promise<ChangesData>;
  explore(scope: Scope, filters: ExploreFilters): Promise<ExploreData>;
  call(id: string): Promise<CallDetail>;
  /** URL of original recording audio, or null when only synthetic preview is possible. */
  audioUrl(id: string): string | null;
  themes(scope: Scope): Promise<ThemesData>;
  theme(scope: Scope, id: string): Promise<ThemeDetail>;
  cases: CaseApi;
  labels: LabelApi;
}

export class DataError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

const SourceContext = createContext<DataSource | null>(null);
export const SourceProvider = SourceContext.Provider;
export function useSource(): DataSource {
  const source = useContext(SourceContext);
  if (!source) throw new Error('useSource outside SourceProvider');
  return source;
}

export type Loaded<T> = {
  data: T | undefined;
  error: DataError | null;
  loading: boolean;
  reload: () => void;
  /** Replace the loaded value after a successful write. */
  set: (value: T) => void;
};

/**
 * Load a value from the active data source. `key` must change whenever the request
 * changes; stale responses for an earlier key are discarded.
 */
export function useData<T>(key: string, load: (source: DataSource) => Promise<T>, enabled = true): Loaded<T> {
  const source = useSource();
  const [state, setState] = useState<{ key: string; data?: T; error: DataError | null }>({ key: '', error: null });
  const [nonce, setNonce] = useState(0);
  const loader = useRef(load);
  useLayoutEffect(() => {
    loader.current = load;
  });
  const fullKey = `${source.mode}:${key}:${nonce}`;
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    loader
      .current(source)
      .then((data) => current && setState({ key: fullKey, data, error: null }))
      .catch((error: unknown) => current && setState({ key: fullKey, error: toDataError(error) }));
    return () => {
      current = false;
    };
  }, [fullKey, source, enabled]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const set = useCallback((value: T) => setState((prev) => ({ ...prev, data: value, error: null })), []);
  const settled = state.key === fullKey;
  return {
    data: state.data,
    error: settled ? state.error : null,
    loading: !settled,
    reload,
    set,
  };
}

export function toDataError(error: unknown): DataError {
  if (error instanceof DataError) return error;
  if (error instanceof Error) return new DataError(error.message);
  return new DataError('The request could not be completed.');
}
