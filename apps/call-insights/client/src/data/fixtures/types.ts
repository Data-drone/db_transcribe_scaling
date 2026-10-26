export type Queue =
  | 'Cards and checks'
  | 'Payments'
  | 'Account access'
  | 'General enquiries'

export type Sentiment = 'negative' | 'neutral' | 'positive'
export type Resolution = 'resolved' | 'unresolved' | 'transferred' | 'unclear'
export type DateRange = '7d' | '30d'
export type Confidence = 'low' | 'medium' | 'high'
export type LabelStatus = 'draft' | 'tested' | 'ran' | 'active' | 'archived'
export type Verdict = 'correct' | 'incorrect'

export type Segment = {
  idx: number
  start: number
  end: number
  role: 'agent' | 'customer'
  text: string
  event?: string
}

export type KeyMoment = {
  label: string
  start: number
  quote: string
}

export type Interaction = {
  id: string
  startedAt: string
  durationSeconds: number
  queue: Queue
  agentId: string
  agentName: string
  customerId: string
  contactReason: string
  sentimentStart: Sentiment
  sentimentEnd: Sentiment
  resolution: Resolution
  summary: string
  themes: string[]
  labels: string[]
  repeatContact: boolean
  transferCount: number
  talkRatioAgent: number
  longestSilence: number
  overtalkCount: number
  holdCount: number
  keyMoments: KeyMoment[]
  segments: Segment[]
}

export type Theme = {
  id: string
  name: string
  summary: string
  count: number
  countChangePct: number
  ahtSeconds: number
  ahtVsOverall: number
  repeatRate: number
  repeatVsOverall: number
  extraAgentHours: number
  drivers: { name: string; share: number }[]
  byQueue: { queue: Queue; count: number; ahtSeconds: number }[]
  daily: { date: string; count: number }[]
  representativeIds: string[]
}

export type LabelResult = {
  interactionId: string
  matched: boolean
  confidence: Confidence
  evidenceQuote: string
  evidenceStart: number
  reason: string
  grounded: boolean
  verdict?: Verdict
}

export type LabelDef = {
  id: string
  name: string
  owner: string
  status: LabelStatus
  tracked: boolean
  version: number
  definition: string
  includeExamples: string
  excludeExamples: string
  speakerFocus: 'any' | 'customer' | 'agent'
  matchShare: number
  matchedCount: number
  scopeCount: number
  agreement: { correct: number; reviewed: number }
  lastRun: string
  byQueue: { queue: Queue; share: number }[]
  sample: LabelResult[]
}

export type CaseItem = {
  id: string
  type: 'clip' | 'interaction' | 'theme' | 'label' | 'note'
  refId: string
  start?: number
  end?: number
  note: string
}

export type CaseRecord = {
  id: string
  title: string
  owner: string
  updatedAt: string
  impactLabel?: string
  items: CaseItem[]
}

export type AskAnswer = {
  question: string
  prose: string
  sql: string
  columns: string[]
  rows: { cells: string[]; href?: string }[]
}

export type ExploreFilters = {
  queue: Queue | 'all'
  dateRange: DateRange
  keyword: string
  reason: string
  sentiment: Sentiment | 'all'
  theme: string
  silence: boolean
  page: number
}

export type Route =
  | { name: 'overview' }
  | { name: 'explore'; filters?: Partial<ExploreFilters> }
  | { name: 'ask'; q?: string }
  | { name: 'labels' }
  | { name: 'label'; id: string }
  | { name: 'cases' }
  | { name: 'case'; id: string }
  | { name: 'theme'; id: string }
  | { name: 'call'; id: string; from?: string; t?: number }
