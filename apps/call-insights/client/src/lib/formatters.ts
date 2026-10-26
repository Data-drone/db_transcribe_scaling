export function formatDuration(value: number | string): string {
  const seconds = Math.round(Number(value));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

export function formatTime(value: number | string): string {
  const seconds = Math.max(0, Math.floor(Number(value)));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatPercent(value: number | string, digits = 0): string {
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
}
