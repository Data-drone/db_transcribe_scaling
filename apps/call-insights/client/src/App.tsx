import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, useNavigate } from 'react-router';
import { Icon, type IconName } from './components/Icon';
import { LinkBtn, Loading } from './components/ui';
import { toPath, type Route } from './router';
import { scopeLabel } from './lib/scope';
import { CallDetail } from './screens/CallDetail';
import { CaseDetail, Cases } from './screens/Cases';
import { Explore } from './screens/Explore';
import { LabelBuilder, Labels } from './screens/Labels';
import { Overview } from './screens/Overview';
import { ThemeDetail, Themes } from './screens/Themes';
import { DataModeProvider, useDataMode, useWorkspace, WorkspaceProvider } from './store';
import { useSource } from './data/source';

type NavItem = { section: string; route: Route; label: string; icon: IconName; secondary?: boolean };
const NAV: NavItem[] = [
  { section: 'overview', route: { name: 'overview' }, label: 'Overview', icon: 'overview' },
  { section: 'explore', route: { name: 'explore' }, label: 'Explore calls', icon: 'explore' },
  { section: 'themes', route: { name: 'themes' }, label: 'Themes', icon: 'pulse' },
  { section: 'cases', route: { name: 'cases' }, label: 'Investigations', icon: 'cases' },
  { section: 'labels', route: { name: 'labels' }, label: 'Labels', icon: 'labels', secondary: true },
  { section: 'ask', route: { name: 'ask' }, label: 'Ask your calls', icon: 'ask', secondary: true },
];
const SCOPED = ['overview', 'explore', 'themes'];
// Genie chat pulls in a large client; load it only when Ask is opened.
const Ask = lazy(() => import('./screens/Ask').then((m) => ({ default: m.Ask })));

function sectionFor(pathname: string, search: string) {
  const first = pathname.split('/').filter(Boolean)[0] ?? 'overview';
  if (first === 'calls') {
    const from = new URLSearchParams(search).get('from') ?? '';
    if (from.startsWith('/cases')) return 'cases';
    if (from.startsWith('/labels')) return 'labels';
    if (from.startsWith('/themes')) return 'themes';
    if (from.startsWith('/ask')) return 'ask';
    return 'explore';
  }
  return first;
}

function Layout() {
  const location = useLocation();
  const source = useSource();
  const { mode, setMode, canSwitch } = useDataMode();
  const { bounds, identity, selection } = useWorkspace();
  const section = sectionFor(location.pathname, location.search);
  const sectionLabel = NAV.find((item) => item.section === section)?.label ?? 'Overview';
  const scoped = SCOPED.includes(section) && !location.pathname.startsWith('/calls');
  const email = identity.data?.email;
  const initials = (identity.data?.name ?? email ?? '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return (
    <div className="app-layout">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          const main = document.getElementById('main-content');
          main?.focus();
          main?.scrollIntoView({ block: 'start' });
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <LinkBtn className="brand" to={{ name: 'overview' }}>
          <span className="brand-mark">
            <Icon name="pulse" size={24} />
          </span>
          <span>
            call<span className="brand-light">insights</span>
            <small>CONVERSATION INTELLIGENCE</small>
          </span>
        </LinkBtn>
        <div className="workspace-label">
          <span className="workspace-mark">HV</span>
          <span>
            Harper Valley Bank<small>Analyst workspace</small>
          </span>
        </div>
        <nav className="nav" aria-label="Workspace navigation">
          <span className="nav-caption">WORKSPACE</span>
          {NAV.filter((item) => !item.secondary).map((item) => (
            <NavLink key={item.section} item={item} current={section === item.section} />
          ))}
          <span className="nav-caption lab-caption">INTELLIGENCE</span>
          {NAV.filter((item) => item.secondary).map((item) => (
            <NavLink key={item.section} item={item} current={section === item.section} />
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="prototype-note">
            <span className="status-dot" /> {mode === 'live' ? 'LIVE DATA' : 'SAMPLE DATA'}
            <p>{source.describe}</p>
            {canSwitch ? (
              <button className="link small mode-switch" type="button" onClick={() => setMode(mode === 'live' ? 'fixtures' : 'live')}>
                {mode === 'live' ? 'Switch to sample data' : 'Switch to live data'}
              </button>
            ) : null}
          </div>
          <div className="profile">
            <span className="avatar">{initials || '–'}</span>
            <span>
              {identity.data?.name ?? (identity.loading ? 'Signing in…' : 'Signed-in user')}
              <small>{email ?? 'Analyst'}</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <Icon name="chevron" size={13} />
            <span>{sectionLabel}</span>
          </div>
          <div className="topbar-meta">
            <span className={`tag${mode === 'fixtures' ? ' red-tag' : ''}`}>{mode === 'live' ? 'LIVE' : 'SAMPLE DATA'}</span>
            <span className="muted small">Harper Valley Bank</span>
            <span className="mini-avatar">{initials || '–'}</span>
          </div>
        </header>
        <div className="scope-strip" aria-label="Data scope">
          <span>
            <Icon name="shield" size={14} />
            <b>{mode === 'live' ? 'Warehouse data' : 'Fictional sample data'}</b>
          </span>
          {bounds.error ? (
            <span className="warn">Could not reach the data: {bounds.error.message}</span>
          ) : scoped ? (
            <>
              <span>{bounds.data ? `${bounds.data.calls.toLocaleString()} calls you can access` : 'Checking accessible calls…'}</span>
              <span>{scopeLabel(selection, bounds.data)}</span>
            </>
          ) : (
            <>
              <span>{mode === 'live' ? 'Source access is checked per user' : 'Saved in this browser'}</span>
              <span>Saved evidence keeps its source timestamps</span>
            </>
          )}
          <span className="scope-freshness">{bounds.data ? `Recordings to ${bounds.data.maxDate}` : ''}</span>
        </div>
        <main id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
        <footer className="workspace-footer">
          <span>
            CALL INSIGHTS <span className="muted">/ Analyst workspace</span>
          </span>
          <span>{mode === 'live' ? 'Source access enforced per user' : 'Offline sample · no warehouse connection'}</span>
        </footer>
      </div>
    </div>
  );
}

function NavLink({ item, current }: { item: NavItem; current: boolean }) {
  const { selection } = useWorkspace();
  const navigate = useNavigate();
  return (
    <a
      href={toPath(item.route, selection)}
      aria-current={current ? 'page' : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        void navigate(toPath(item.route, selection), { viewTransition: true });
      }}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
    </a>
  );
}

function Root() {
  return (
    <WorkspaceProvider>
      <Layout />
    </WorkspaceProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/', element: <Overview /> },
      { path: '/overview', element: <Navigate to="/" replace /> },
      { path: '/explore', element: <Explore /> },
      { path: '/themes', element: <Themes /> },
      { path: '/themes/:id', element: <ThemeDetail /> },
      { path: '/calls/:id', element: <CallDetail /> },
      { path: '/cases', element: <Cases /> },
      { path: '/cases/:id', element: <CaseDetail /> },
      { path: '/investigations', element: <Navigate to="/cases" replace /> },
      { path: '/labels', element: <Labels /> },
      { path: '/labels/:id', element: <LabelBuilder /> },
      {
        path: '/ask',
        element: (
          <Suspense fallback={<Loading label="Loading Ask…" />}>
            <Ask />
          </Suspense>
        ),
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() {
  return (
    <DataModeProvider>
      <RouterProvider router={router} />
    </DataModeProvider>
  );
}
