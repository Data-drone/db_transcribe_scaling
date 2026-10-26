export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

export function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const r = Math.round(seconds % 60)
  return `${m}m ${String(r).padStart(2, '0')}s`
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export function signedPct(n: number): string {
  const v = Math.round(n * 100)
  return `${v > 0 ? '+' : ''}${v}%`
}

export function signedPts(n: number): string {
  const v = Math.round(n * 100)
  return `${v > 0 ? '+' : ''}${v} pts`
}
