/** Only known in-app destinations can receive the return link. */
export function evidenceReturnPath(value: string | null): string {
  if (!value || value.includes('\\') || [...value].some((character) => character.charCodeAt(0) < 32)) return '/explore';
  return /^\/(?:explore|ask|cases(?:\/[a-zA-Z0-9-]+)?|labels(?:\/[a-zA-Z0-9-]+)?)(?:\?[^#]*)?$/.test(value)
    ? value
    : '/explore';
}
export function evidenceTime(value: string | null): number {
  const time = Number(value);
  return Number.isFinite(time) && time >= 0 ? time : 0;
}
