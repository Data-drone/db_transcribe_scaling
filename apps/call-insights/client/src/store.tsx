import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Bounds, DataMode, Scope } from '../../shared/insights';
import { createFixtureSource } from './data/fixtures';
import { createLiveSource } from './data/live';
import { SourceProvider, useData, type DataSource, type Loaded } from './data/source';
import { DEFAULT_SCOPE, scopeFor, type ScopeSelection } from './lib/scope';

const MODE_KEY = 'call-insights.data-mode';
/** `VITE_DATA_SOURCE=fixtures` builds an offline bundle that never calls the server. */
export const FORCED_MODE: DataMode | null = import.meta.env.VITE_DATA_SOURCE === 'fixtures' ? 'fixtures' : null;

function initialMode(): DataMode {
  if (FORCED_MODE) return FORCED_MODE;
  try {
    return localStorage.getItem(MODE_KEY) === 'fixtures' ? 'fixtures' : 'live';
  } catch {
    return 'live';
  }
}
const sources: Partial<Record<DataMode, DataSource>> = {};
function sourceFor(mode: DataMode) {
  sources[mode] ??= mode === 'fixtures' ? createFixtureSource() : createLiveSource();
  return sources[mode];
}

type ModeState = { mode: DataMode; setMode: (mode: DataMode) => void; canSwitch: boolean };
const ModeContext = createContext<ModeState | null>(null);

export function DataModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DataMode>(initialMode);
  const setMode = useCallback((next: DataMode) => {
    if (FORCED_MODE) return;
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* The choice lasts for this session. */
    }
    setModeState(next);
  }, []);
  const value = useMemo(() => ({ mode, setMode, canSwitch: !FORCED_MODE }), [mode, setMode]);
  return (
    <ModeContext.Provider value={value}>
      <SourceProvider value={sourceFor(mode)}>{children}</SourceProvider>
    </ModeContext.Provider>
  );
}
export function useDataMode() {
  const value = useContext(ModeContext);
  if (!value) throw new Error('useDataMode outside DataModeProvider');
  return value;
}

type Workspace = {
  bounds: Loaded<Bounds>;
  identity: Loaded<{ email: string | null; name: string | null }>;
  selection: ScopeSelection;
  setSelection: (selection: ScopeSelection) => void;
  scope: Scope;
};
const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const bounds = useData('bounds', (source) => source.bounds());
  const identity = useData('identity', (source) => source.identity());
  const [selection, setSelectionState] = useState<ScopeSelection>(DEFAULT_SCOPE);
  const setSelection = useCallback(
    (next: ScopeSelection) =>
      setSelectionState((prev) => (prev.period === next.period && prev.queue === next.queue ? prev : next)),
    []
  );
  const scope = useMemo(() => scopeFor(selection, bounds.data), [selection, bounds.data]);
  const value = useMemo(() => ({ bounds, identity, selection, setSelection, scope }), [bounds, identity, selection, setSelection, scope]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace outside WorkspaceProvider');
  return value;
}
