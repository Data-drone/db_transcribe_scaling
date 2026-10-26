import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { INITIAL_CASES, INITIAL_LABELS } from './data'
import { exploreFiltersFromHash } from './cohort'
import type { CaseItem, CaseRecord, DateRange, LabelDef, Queue, Verdict } from './types'

type Store = {
  dateRange: DateRange
  queue: Queue | 'all'
  setDateRange: (v: DateRange) => void
  setQueue: (v: Queue | 'all') => void
  labels: LabelDef[]
  upsertLabel: (label: LabelDef) => void
  setVerdict: (labelId: string, interactionId: string, verdict: Verdict) => void
  cases: CaseRecord[]
  storageStatus: 'saved' | 'unavailable'
  addCase: (title: string) => string
  renameCase: (caseId: string, title: string) => void
  addCaseItem: (caseId: string, item: Omit<CaseItem, 'id'>) => void
}

const Ctx = createContext<Store | null>(null)
const STORAGE_KEY = 'call-insights.local-cases.v1'

function loadCases(): CaseRecord[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (Array.isArray(stored) && stored.every((item) =>
      item && typeof item.id === 'string' && typeof item.title === 'string' &&
      typeof item.owner === 'string' && typeof item.updatedAt === 'string' &&
      Array.isArray(item.items) && item.items.every((entry: CaseItem) =>
        entry && typeof entry.id === 'string' && typeof entry.refId === 'string' &&
        typeof entry.note === 'string' && ['clip', 'interaction', 'theme', 'label', 'note'].includes(entry.type),
      ),
    )) return stored
  } catch { /* An unavailable or outdated browser store starts with the demo case. */ }
  return INITIAL_CASES
}

function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Perth' })
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [initialScope] = useState(scopeFromLocation)
  const [dateRange, setDateRange] = useState<DateRange>(initialScope.dateRange)
  const [queue, setQueue] = useState<Queue | 'all'>(initialScope.queue)
  const [labels, setLabels] = useState(INITIAL_LABELS)
  const [cases, setCases] = useState(loadCases)
  const [storageStatus, setStorageStatus] = useState<'saved' | 'unavailable'>('saved')

  useEffect(() => {
    let disposed = false
    queueMicrotask(() => {
      if (disposed) return
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cases))
        setStorageStatus('saved')
      } catch {
        setStorageStatus('unavailable')
      }
    })
    return () => { disposed = true }
  }, [cases])

  useEffect(() => {
    const syncScope = () => {
      const scope = scopeFromLocation({ queue, dateRange })
      setQueue(scope.queue)
      setDateRange(scope.dateRange)
    }
    window.addEventListener('hashchange', syncScope)
    return () => window.removeEventListener('hashchange', syncScope)
  }, [queue, dateRange])

  const upsertLabel = useCallback((label: LabelDef) => {
    setLabels((prev) => {
      const i = prev.findIndex((l) => l.id === label.id)
      if (i === -1) return [label, ...prev]
      const next = prev.slice()
      next[i] = label
      return next
    })
  }, [])

  const setVerdict = useCallback((labelId: string, interactionId: string, verdict: Verdict) => {
    setLabels((prev) =>
      prev.map((l) => {
        if (l.id !== labelId) return l
        const sample = l.sample.map((r) =>
          r.interactionId === interactionId ? { ...r, verdict } : r,
        )
        const reviewed = sample.filter((r) => r.verdict).length
        const correct = sample.filter((r) => r.verdict === 'correct').length
        return { ...l, sample, agreement: { correct, reviewed } }
      }),
    )
  }, [])

  const addCase = useCallback((title: string) => {
    const id = `case-${crypto.randomUUID()}`
    setCases((prev) => [
      {
        id,
        title: title.trim() || 'Untitled investigation',
        owner: 'you',
        updatedAt: today(),
        items: [],
      },
      ...prev,
    ])
    return id
  }, [])

  const renameCase = useCallback((caseId: string, title: string) => {
    if (!title.trim()) return
    setCases((prev) => prev.map((c) => c.id === caseId ? { ...c, title: title.trim(), updatedAt: today() } : c))
  }, [])

  const addCaseItem = useCallback((caseId: string, item: Omit<CaseItem, 'id'>) => {
    setCases((prev) =>
      prev.map((c) =>
        c.id === caseId
          ? {
              ...c,
              updatedAt: today(),
              items: [...c.items, { ...item, id: `it-${crypto.randomUUID()}` }],
            }
          : c,
      ),
    )
  }, [])

  const value = useMemo(
    () => ({
      dateRange,
      queue,
      setDateRange,
      setQueue,
      labels,
      upsertLabel,
      setVerdict,
      cases,
      storageStatus,
      addCase,
      renameCase,
      addCaseItem,
    }),
    [dateRange, queue, labels, upsertLabel, setVerdict, cases, storageStatus, addCase, renameCase, addCaseItem],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStore outside provider')
  return v
}

function scopeFromLocation(fallback: { queue?: Queue | 'all'; dateRange?: DateRange } = {}) {
  const hash = window.location.hash
  const params = new URLSearchParams(hash.split('?')[1] ?? '')
  const from = params.get('from')
  return exploreFiltersFromHash(from?.startsWith('#/') ? from : hash, fallback)
}
