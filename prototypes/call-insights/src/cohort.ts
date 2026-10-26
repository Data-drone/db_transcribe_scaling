import { INTERACTIONS, QUEUES, THEMES } from './data'
import { maskedText } from './privacy'
import type { ExploreFilters, Route } from './types'

export const MOCK_PERIOD_END = '2026-10-22'
export const DEFAULT_EXPLORE_FILTERS: ExploreFilters = {
  queue: 'all',
  dateRange: '7d',
  keyword: '',
  reason: 'all',
  sentiment: 'all',
  theme: 'all',
  silence: false,
  page: 1,
}

export function exploreFiltersFromHash(
  hash: string,
  fallback: Partial<ExploreFilters> = {},
): ExploreFilters {
  const query = hash.slice(hash.indexOf('?') + 1)
  const params = new URLSearchParams(hash.includes('?') ? query : '')
  const defaults = { ...DEFAULT_EXPLORE_FILTERS, ...fallback }
  const queue = params.get('queue') ?? defaults.queue
  const sentiment = params.get('sentiment') ?? defaults.sentiment
  const dateRange = params.get('period') ?? defaults.dateRange
  const theme = params.get('theme') ?? defaults.theme
  const reason = params.get('reason') ?? defaults.reason
  const page = Number(params.get('page') ?? defaults.page)
  return {
    queue: QUEUES.includes(queue as typeof QUEUES[number]) ? queue as ExploreFilters['queue'] : 'all',
    dateRange: dateRange === '30d' ? '30d' : '7d',
    keyword: params.get('q') ?? defaults.keyword,
    reason: INTERACTIONS.some((call) => call.contactReason === reason) ? reason : 'all',
    sentiment: sentiment === 'negative' || sentiment === 'neutral' || sentiment === 'positive' ? sentiment : 'all',
    theme: THEMES.some((item) => item.id === theme) ? theme : 'all',
    silence: params.has('silence') ? params.get('silence') === '1' : defaults.silence,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  }
}

export function exploreRoute(filters: Partial<ExploreFilters> = {}): Route {
  return { name: 'explore', filters }
}

export function exploreHash(filters: Partial<ExploreFilters> = {}): string {
  const selected = { ...DEFAULT_EXPLORE_FILTERS, ...filters }
  const params = new URLSearchParams()
  params.set('period', selected.dateRange)
  params.set('queue', selected.queue)
  if (selected.keyword) params.set('q', selected.keyword)
  if (selected.reason !== 'all') params.set('reason', selected.reason)
  if (selected.sentiment !== 'all') params.set('sentiment', selected.sentiment)
  if (selected.theme !== 'all') params.set('theme', selected.theme)
  if (selected.silence) params.set('silence', '1')
  if (selected.page > 1) params.set('page', String(selected.page))
  return `#/explore?${params.toString()}`
}

export function filterInteractions(filters: Partial<ExploreFilters> = {}) {
  const selected = { ...DEFAULT_EXPLORE_FILTERS, ...filters }
  const cutoff = selected.dateRange === '7d' ? '2026-10-16' : '2026-09-23'
  const keyword = selected.keyword.trim().toLowerCase()
  return INTERACTIONS.filter((call) => {
    const day = call.startedAt.slice(0, 10)
    if (day < cutoff || day > MOCK_PERIOD_END) return false
    if (selected.queue !== 'all' && call.queue !== selected.queue) return false
    if (selected.reason !== 'all' && call.contactReason !== selected.reason) return false
    if (selected.sentiment !== 'all' && call.sentimentEnd !== selected.sentiment) return false
    if (selected.theme !== 'all' && !call.themes.includes(selected.theme)) return false
    if (selected.silence && call.longestSilence < 10) return false
    if (keyword && !maskedText(call.summary).toLowerCase().includes(keyword) && !call.segments.some((segment) => maskedText(segment.text).toLowerCase().includes(keyword))) return false
    return true
  }).sort((left, right) => right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id))
}
