import type { CSSProperties } from 'react'

export type IconName = 'overview' | 'explore' | 'cases' | 'labels' | 'ask' | 'arrow' | 'chevron' | 'calendar' | 'check' | 'headphones' | 'shield' | 'pulse'
const paths: Record<IconName, string> = {
  overview: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  explore: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  cases: 'M3 7h18v13H3zM8 7V4h8v3M3 12h18M10 12v3h4v-3',
  labels: 'M3 3h8l10 10-8 8L3 11zM7 7h.01',
  ask: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  arrow: 'M4 12h16M14 6l6 6-6 6',
  chevron: 'M9 5l7 7-7 7',
  calendar: 'M4 5h16v16H4zM8 2v6M16 2v6M4 10h16',
  check: 'M5 12l4 4L19 6',
  headphones: 'M4 15v-4a8 8 0 0 1 16 0v4M4 12H2v8h5v-8zM20 12h2v8h-5v-8z',
  shield: 'M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6zM8 11l3 3 5-5',
  pulse: 'M2 12h5l3-8 4 16 3-8h5',
}
export function Icon({ name, size = 18, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>
}
