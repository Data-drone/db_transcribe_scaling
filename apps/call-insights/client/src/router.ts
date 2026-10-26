import type { ExploreFilters } from '../../shared/insights';
import { filterParams, selectionParams, type ScopeSelection } from './lib/scope';

export type Route =
  | { name: 'overview' }
  | { name: 'explore'; filters?: Partial<ExploreFilters> }
  | { name: 'themes' }
  | { name: 'theme'; id: string }
  | { name: 'call'; id: string; from?: string; t?: number }
  | { name: 'cases' }
  | { name: 'case'; id: string }
  | { name: 'labels' }
  | { name: 'label'; id: string; params?: Record<string, string> }
  | { name: 'ask'; q?: string };

const SCOPED: Route['name'][] = ['overview', 'explore', 'themes', 'theme'];

/** Build an in-app path. Scoped pages carry the current period and queue in the URL. */
export function toPath(route: Route, scope?: ScopeSelection): string {
  const params = new URLSearchParams(scope && SCOPED.includes(route.name) ? selectionParams(scope) : {});
  let path: string;
  switch (route.name) {
    case 'overview':
      path = '/';
      break;
    case 'explore':
      path = '/explore';
      for (const [k, v] of Object.entries(filterParams(route.filters ?? {}))) params.set(k, v);
      break;
    case 'themes':
      path = '/themes';
      break;
    case 'theme':
      path = `/themes/${encodeURIComponent(route.id)}`;
      break;
    case 'call':
      path = `/calls/${encodeURIComponent(route.id)}`;
      if (route.t != null && Number.isFinite(route.t) && route.t >= 0) params.set('t', String(Math.floor(route.t * 100) / 100));
      if (route.from) params.set('from', route.from);
      break;
    case 'cases':
      path = '/cases';
      break;
    case 'case':
      path = `/cases/${encodeURIComponent(route.id)}`;
      break;
    case 'labels':
      path = '/labels';
      break;
    case 'label':
      path = `/labels/${encodeURIComponent(route.id)}`;
      for (const [k, v] of Object.entries(route.params ?? {})) params.set(k, v);
      break;
    case 'ask':
      path = '/ask';
      if (route.q) params.set('q', route.q);
      break;
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
