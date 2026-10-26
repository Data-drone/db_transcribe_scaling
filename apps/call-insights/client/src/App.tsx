import { createBrowserRouter, RouterProvider, NavLink, Outlet, useLocation, Link, Navigate } from 'react-router';
import {
  Activity,
  ArrowUpRight,
  ChevronRight,
  FolderOpen,
  LayoutDashboard,
  Search,
  ShieldCheck,
  Sparkles,
  Tags,
  UserRound,
} from 'lucide-react';
import { Badge, useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { OverviewPage } from './pages/overview/OverviewPage';
import { ExplorePage } from './pages/explore/ExplorePage';
import { CallDetailPage } from './pages/calls/CallDetailPage';
import { InvestigationsPage } from './pages/investigations/InvestigationsPage';
import { IntelligencePage } from './pages/intelligence/IntelligencePage';
import { AskPage } from './pages/ask/AskPage';
import { useWorkspaceIdentity } from './components/workspace/WorkspaceIdentity';

const destinations = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/explore', label: 'Explore calls', icon: Search },
  { to: '/cases', label: 'Investigations', icon: FolderOpen },
  { to: '/labels', label: 'Labels', icon: Tags, intelligence: true },
  { to: '/ask', label: 'Ask your calls', icon: Sparkles, intelligence: true },
];
function Layout() {
  const location = useLocation();
  const identity = useWorkspaceIdentity();
  const bounds = useAnalyticsQuery('dataset_bounds', {});
  const sourceParams = new URLSearchParams(location.search);
  const origin = sourceParams.get('from');
  const scopeParams =
    location.pathname.startsWith('/calls/') && origin?.startsWith('/explore')
      ? new URLSearchParams(origin.split('?')[1])
      : sourceParams;
  const navigationScope = new URLSearchParams();
  for (const name of ['queue', 'start', 'end']) {
    const value = scopeParams.get(name);
    if (value) navigationScope.set(name, value);
  }
  const scope = navigationScope.toString() ? `?${navigationScope}` : '';
  const selected = destinations.find((item) =>
    item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
  );
  const section = selected?.label ?? (location.pathname.startsWith('/calls/') ? 'Conversation evidence' : 'Workspace');
  const dataset = bounds.data?.[0];
  const collectionScope = location.pathname.startsWith('/cases')
    ? 'Saved evidence · sources rechecked on open'
    : location.pathname.startsWith('/labels')
      ? 'Scope defined by each label version'
      : location.pathname === '/ask'
        ? 'Scope follows your question'
        : null;
  const initials = identity.email
    ? identity.email
        .split('@')[0]
        .split(/[._-]/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('')
    : null;
  return (
    <div className="ci-workspace">
      <a
        className="ci-skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          const main = document.getElementById('main-content');
          main?.focus();
          main?.scrollIntoView();
        }}
      >
        Skip to content
      </a>
      <aside className="ci-sidebar">
        <Link className="ci-brand" to={`/${scope}`} aria-label="Call Insights home">
          <span className="ci-brand-mark">
            <Activity size={24} />
          </span>
          <span>
            call<span>insights</span>
            <small>CONVERSATION INTELLIGENCE</small>
          </span>
        </Link>
        <div className="ci-workspace-label">
          <span>HV</span>
          <div>
            Harper Valley Bank<small>Analyst workspace</small>
          </div>
        </div>
        <nav className="ci-nav" aria-label="Workspace navigation">
          <span className="ci-nav-caption">WORKSPACE</span>
          {destinations.map((item) => (
            <div key={item.to} className="ci-nav-group">
              {item.to === '/labels' && <span className="ci-nav-caption ci-intelligence-caption">INTELLIGENCE</span>}
              <NavLink
                to={`${item.to}${item.to === '/' || item.to === '/explore' ? scope : ''}`}
                end={item.end}
                className={({ isActive }) =>
                  `ci-nav-link${isActive || (item.to === '/explore' && location.pathname.startsWith('/calls/')) ? ' ci-nav-active' : ''}`
                }
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            </div>
          ))}
        </nav>
        <div className="ci-sidebar-bottom">
          <div className="ci-connection">
            <span className={bounds.error ? 'ci-dot ci-dot-error' : 'ci-dot'} />
            {bounds.error ? 'DATA CONNECTION ERROR' : bounds.loading ? 'CONNECTING TO DATA' : 'UNITY CATALOG DATA'}
            <small>HarperValleyBank corpus</small>
          </div>
          <div className="ci-profile">
            <span className="ci-avatar">{initials ?? <UserRound size={15} />}</span>
            <div>
              {identity.email ?? identity.user ?? 'Authenticated workspace user'}
              <small>Data access uses your permissions</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="ci-main">
        <header className="ci-topbar">
          <div>
            Workspace <ChevronRight size={13} />
            <span>{section}</span>
          </div>
          <div>
            <Badge variant="outline">
              {bounds.error ? 'Connection error' : bounds.loading ? 'Connecting' : 'Live data'}
            </Badge>
            <ShieldCheck size={15} />
          </div>
        </header>
        <div className="ci-scopebar">
          <span>
            <ShieldCheck size={14} /> Governed call data
          </span>
          <span>
            {bounds.error
              ? 'Check data access or warehouse availability'
              : bounds.loading
                ? 'Checking accessible conversations…'
                : `${Number(dataset?.interaction_count ?? 0).toLocaleString()} accessible conversations`}
          </span>
          <span>
            {collectionScope ??
              (scopeParams.get('queue') && scopeParams.get('queue') !== 'all'
                ? scopeParams.get('queue')
                : 'All queues')}
            {!collectionScope && (
              <>
                {' '}
                ·{' '}
                {scopeParams.get('start') || scopeParams.get('end')
                  ? `${scopeParams.get('start') || 'Start'} to ${scopeParams.get('end') || 'End'}`
                  : 'All recording dates'}
              </>
            )}
          </span>
        </div>
        <main id="main-content" tabIndex={-1} className="ci-content">
          <Outlet />
        </main>
        <footer className="ci-footer">
          <span>
            CALL INSIGHTS <span>/ Analyst workspace</span>
          </span>
          <span>
            Source access enforced per user <ArrowUpRight size={11} />
          </span>
        </footer>
      </div>
    </div>
  );
}
const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <OverviewPage /> },
      { path: '/explore', element: <ExplorePage /> },
      { path: '/calls/:interactionId', element: <CallDetailPage /> },
      { path: '/cases', element: <InvestigationsPage /> },
      { path: '/cases/:caseId', element: <InvestigationsPage /> },
      { path: '/investigations', element: <Navigate to="/cases" replace /> },
      { path: '/labels', element: <IntelligencePage /> },
      { path: '/labels/:labelId', element: <IntelligencePage /> },
      { path: '/ask', element: <AskPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
export default function App() {
  return <RouterProvider router={router} />;
}
