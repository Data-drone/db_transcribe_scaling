import type { LabelTracking } from '../../../shared/insights';

/** Flag days where the matching share moved by at least 10 points and 50% from the previous recording day. */
export function trackingJumps(points: LabelTracking['points']) {
  const shares = points.map((p) => ({ date: p.date, share: p.evaluated ? p.matched / p.evaluated : 0, evaluated: p.evaluated }));
  return shares.slice(1).flatMap((p, i) => {
    const prev = shares[i];
    const delta = p.share - prev.share;
    return p.evaluated >= 5 && Math.abs(delta) >= 0.1 && (prev.share === 0 || Math.abs(delta) / prev.share >= 0.5) ? [{ ...p, delta }] : [];
  });
}
