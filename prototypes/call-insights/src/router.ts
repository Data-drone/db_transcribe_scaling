import type { Route } from './types'
import { exploreFiltersFromHash, exploreHash } from './cohort'

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/overview'
  const [pathPart, queryPart] = raw.split('?')
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`
  const params = new URLSearchParams(queryPart ?? '')
  const parts = path.split('/').filter(Boolean)

  if (parts[0] === 'explore') return { name: 'explore', filters: exploreFiltersFromHash(hash) }
  if (parts[0] === 'ask') return { name: 'ask', q: params.get('q') ?? undefined }
  if (parts[0] === 'labels' && parts[1]) return { name: 'label', id: parts[1] }
  if (parts[0] === 'labels') return { name: 'labels' }
  if (parts[0] === 'cases' && parts[1]) return { name: 'case', id: parts[1] }
  if (parts[0] === 'cases') return { name: 'cases' }
  if (parts[0] === 'themes' && parts[1]) return { name: 'theme', id: parts[1] }
  if (parts[0] === 'calls' && parts[1]) {
    const t = params.get('t')
    return {
      name: 'call',
      id: parts[1],
      from: params.get('from') ?? undefined,
      t: t ? Number(t) : undefined,
    }
  }
  return { name: 'overview' }
}

export function toHash(route: Route): string {
  switch (route.name) {
    case 'overview':
      return '#/overview'
    case 'explore':
      return exploreHash(route.filters)
    case 'ask':
      return route.q ? `#/ask?q=${encodeURIComponent(route.q)}` : '#/ask'
    case 'labels':
      return '#/labels'
    case 'label':
      return `#/labels/${route.id}`
    case 'cases':
      return '#/cases'
    case 'case':
      return `#/cases/${route.id}`
    case 'theme':
      return `#/themes/${route.id}`
    case 'call': {
      const q = new URLSearchParams()
      if (route.from) q.set('from', route.from)
      if (route.t != null) q.set('t', String(route.t))
      const qs = q.toString()
      return `#/calls/${route.id}${qs ? `?${qs}` : ''}`
    }
  }
}

export function go(route: Route) {
  window.location.hash = toHash(route).slice(1)
}
