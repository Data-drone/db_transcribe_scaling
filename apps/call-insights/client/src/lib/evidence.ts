/** Only known in-app destinations can receive the return link. */
export function evidenceReturnPath(value: string | null): string {
  if (!value || value.includes('\\') || [...value].some((character) => character.charCodeAt(0) < 32)) return '/explore';
  return /^\/(?:explore|ask|themes\/[A-Za-z0-9_-]+|cases(?:\/[a-zA-Z0-9-]+)?|labels(?:\/[a-zA-Z0-9-]+)?)?(?:\?[^#]*)?$/.test(value)
    ? value
    : '/explore';
}
export function evidenceTime(value: string | null): number {
  const time = Number(value);
  return Number.isFinite(time) && time >= 0 ? time : 0;
}
export function returnLabel(path: string) {
  if (path.startsWith('/cases/')) return 'Back to case';
  if (path.startsWith('/themes/')) return 'Back to theme';
  if (path.startsWith('/labels/')) return 'Back to label';
  if (path.startsWith('/ask')) return 'Back to Ask';
  if (path === '/' || path.startsWith('/?')) return 'Back to overview';
  return 'Back to results';
}
