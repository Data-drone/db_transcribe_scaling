import { useEffect, useState } from 'react'
import { Icon, type IconName } from './components/Icon'
import { filterInteractions } from './cohort'
import { INTERACTIONS } from './data'
import { parseHash } from './router'
import { Ask } from './screens/Ask'
import { CallDetail } from './screens/CallDetail'
import { CaseDetail, Cases } from './screens/Cases'
import { Explore } from './screens/Explore'
import { LabelBuilder, Labels } from './screens/Labels'
import { Overview } from './screens/Overview'
import { ThemeDetail } from './screens/ThemeDetail'
import { StoreProvider, useStore } from './store'
import type { Route } from './types'

const NAV: { name: Route['name']; href: string; label: string; icon: IconName; secondary?: boolean }[] = [
  { name: 'overview', href: '#/overview', label: 'Overview', icon: 'overview' },
  { name: 'explore', href: '#/explore', label: 'Explore calls', icon: 'explore' },
  { name: 'cases', href: '#/cases', label: 'Investigations', icon: 'cases' },
  { name: 'labels', href: '#/labels', label: 'Labels', icon: 'labels', secondary: true },
  { name: 'ask', href: '#/ask', label: 'Ask your calls', icon: 'ask', secondary: true },
]
function currentNav(route: Route): Route['name'] {
  if (route.name === 'theme') return 'overview'
  if (route.name === 'call') return route.from?.includes('cases') || route.from?.startsWith('case:') ? 'cases' : 'explore'
  if (route.name === 'label') return 'labels'
  if (route.name === 'case') return 'cases'
  return route.name
}
function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'overview': return <Overview />
    case 'explore': return <Explore />
    case 'ask': return <Ask key={route.q} initial={route.q} />
    case 'labels': return <Labels />
    case 'label': return <LabelBuilder key={route.id} id={route.id} />
    case 'cases': return <Cases />
    case 'case': return <CaseDetail key={route.id} id={route.id} />
    case 'theme': return <ThemeDetail key={route.id} id={route.id} />
    case 'call': return <CallDetail key={route.id} id={route.id} from={route.from} t={route.t} />
  }
}
function Shell() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  const { queue, dateRange, cases } = useStore()
  useEffect(() => {
    const onHash = () => { setRoute(parseHash(window.location.hash)); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    if (!window.location.hash) window.location.hash = '/overview'
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const nav = currentNav(route)
  const selected = filterInteractions({ queue, dateRange })
  const scopeQuery = new URLSearchParams({ period: dateRange, queue }).toString()
  const collectionView = ['cases', 'case', 'labels', 'label', 'ask'].includes(route.name)
  const sectionLabel = NAV.find(item => item.name === nav)?.label ?? 'Overview'
  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); const main = document.getElementById('main-content'); main?.focus(); main?.scrollIntoView({ block: 'start' }) }}>Skip to content</a>
      <aside className="sidebar">
        <a className="brand" href="#/overview" aria-label="Call Insights home"><span className="brand-mark"><Icon name="pulse" size={24}/></span><span>call<span className="brand-light">insights</span><small>CONVERSATION INTELLIGENCE</small></span></a>
        <div className="workspace-label"><span className="workspace-mark">HV</span><span>Harper Valley Bank<small>Analyst workspace</small></span></div>
        <nav className="nav" aria-label="Workspace navigation">
          <span className="nav-caption">WORKSPACE</span>
          {NAV.filter(item => !item.secondary).map(item => <a key={item.name} href={item.name === 'overview' || item.name === 'explore' ? `${item.href}?${scopeQuery}` : item.href} aria-current={nav === item.name ? 'page' : undefined}><Icon name={item.icon}/><span>{item.label}</span>{item.name === 'cases' && <span className="nav-count">{cases.length}</span>}</a>)}
          <span className="nav-caption lab-caption">EXPERIMENTS <span>DEMO</span></span>
          {NAV.filter(item => item.secondary).map(item => <a key={item.name} href={item.name === 'overview' || item.name === 'explore' ? `${item.href}?${scopeQuery}` : item.href} aria-current={nav === item.name ? 'page' : undefined}><Icon name={item.icon}/><span>{item.label}</span></a>)}
        </nav>
        <div className="sidebar-bottom"><div className="prototype-note"><span className="status-dot"/> LOCAL PROTOTYPE<p>Synthetic calls. Real workflow.</p></div><div className="profile"><span className="avatar">BL</span><span>Brian Law<small>Demo analyst</small></span><Icon name="chevron" size={15}/></div></div>
      </aside>
      <div className="workspace-main">
        <header className="topbar"><div className="breadcrumb">Workspace <Icon name="chevron" size={13}/><span>{sectionLabel}</span></div><div className="topbar-meta"><span className="tag">LOCAL PREVIEW</span><span className="muted small">Harper Valley Bank</span><span className="mini-avatar">BL</span></div></header>
        <div className="scope-strip" aria-label="Data scope"><span><Icon name="shield" size={14}/><b>Synthetic dataset</b></span>{collectionView ? <><span>Local analyst workspace</span><span>Saved evidence retains its source timestamps</span></> : <><span>{selected.length} of {INTERACTIONS.length} demo calls in scope</span><span>{dateRange === '7d' ? '16–22 Oct' : '23 Sep–22 Oct'} 2026 · {queue === 'all' ? 'All queues' : queue}</span></>}<span className="scope-freshness">Snapshot · 22 Oct 2026</span></div>
        <main id="main-content" tabIndex={-1}><Screen route={route}/></main>
        <footer className="workspace-footer"><span>CALL INSIGHTS <span className="muted">/ Analyst workspace</span></span><span>Local demo · No warehouse connection</span></footer>
      </div>
    </div>
  )
}
export default function App() { return <StoreProvider><Shell /></StoreProvider> }
