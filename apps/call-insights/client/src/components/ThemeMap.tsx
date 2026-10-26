import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ThemeMapPoint, ThemeSummary } from '../../../shared/insights';
import { fmtDuration } from '../lib/format';
import { fmtDay } from '../lib/scope';

/** Validated on the app's dark surface for all-pairs use (scatter): three slots, then "Other". */
const SLOTS = ['#3987e5', '#d95926', '#199e70'];
const OTHER = '#6b6c75';
const FOCUS = '#e5444e';
const W = 1000;
const H = 560;
const PAD = 34;
type View = { k: number; tx: number; ty: number };
const HOME: View = { k: 1, tx: 0, ty: 0 };

function zoomAt(v: View, factor: number, cx: number, cy: number): View {
  const k = Math.min(12, Math.max(1, v.k * factor));
  if (k === 1) return HOME;
  const ratio = k / v.k;
  return { k, tx: cx - (cx - v.tx) * ratio, ty: cy - (cy - v.ty) * ratio };
}
const px = (x: number) => PAD + x * (W - 2 * PAD);
const py = (y: number) => PAD + (1 - y) * (H - 2 * PAD);

export function ThemeMap({
  points,
  themes,
  onOpen,
}: {
  points: ThemeMapPoint[];
  themes: ThemeSummary[];
  onOpen: (callId: string) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>(HOME);
  const [focus, setFocus] = useState('');
  const [hover, setHover] = useState<ThemeMapPoint | null>(null);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);
  const names = useMemo(() => new Map(themes.map((t) => [t.id, t.name])), [themes]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of points) map.set(p.theme, (map.get(p.theme) ?? 0) + 1);
    return [...map].sort((a, b) => b[1] - a[1] || (names.get(a[0]) ?? a[0]).localeCompare(names.get(b[0]) ?? b[0]));
  }, [points, names]);
  const colorOf = useMemo(() => {
    const slot = new Map(counts.slice(0, SLOTS.length).map(([id], i) => [id, SLOTS[i]]));
    return (theme: string) => (focus ? (theme === focus ? FOCUS : OTHER) : (slot.get(theme) ?? OTHER));
  }, [counts, focus]);
  const centroids = useMemo(() => {
    // Label each cluster above its highest dot, centred on its mean x, so text never covers a call.
    const sums = new Map<string, { x: number; top: number; n: number }>();
    for (const p of points) {
      const s = sums.get(p.theme) ?? { x: 0, top: -Infinity, n: 0 };
      sums.set(p.theme, { x: s.x + p.x, top: Math.max(s.top, p.y), n: s.n + 1 });
    }
    return new Map([...sums].map(([id, s]) => [id, { x: s.x / s.n, y: s.top }]));
  }, [points]);
  const labelled = focus ? [focus] : counts.slice(0, SLOTS.length).map(([id]) => id);

  // Ctrl/⌘ + wheel zooms around the pointer; a plain wheel keeps scrolling the page.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = ((event.clientX - rect.left) / rect.width) * W;
      const cy = ((event.clientY - rect.top) / rect.height) * H;
      setView((v) => zoomAt(v, event.deltaY < 0 ? 1.25 : 0.8, cx, cy));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function onDown(event: ReactPointerEvent<SVGSVGElement>) {
    drag.current = { x: event.clientX, y: event.clientY, view, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onMove(event: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    const rect = svg.current!.getBoundingClientRect();
    const dx = ((event.clientX - d.x) / rect.width) * W;
    const dy = ((event.clientY - d.y) / rect.height) * H;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setView({ ...d.view, tx: d.view.tx + dx, ty: d.view.ty + dy });
  }
  const r = 5 / view.k;
  return (
    <div className="theme-map">
      <div className="map-canvas">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Map of ${points.length} themed calls. Similar conversations sit close together; colours show themes. Use the theme list to explore by keyboard.`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={() => (drag.current = null)}
        >
          <rect width={W} height={H} className="map-bg" />
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
            {points.map((p) => {
              const dim = focus && p.theme !== focus;
              return (
                <g key={p.id} className={`map-point${dim ? ' dim' : ''}`}>
                  <circle
                    cx={px(p.x)}
                    cy={py(p.y)}
                    r={r * 2.2}
                    className="map-hit"
                    onPointerEnter={() => setHover(p)}
                    onPointerLeave={() => setHover((h) => (h?.id === p.id ? null : h))}
                    onClick={() => !drag.current?.moved && onOpen(p.id)}
                  />
                  <circle cx={px(p.x)} cy={py(p.y)} r={hover?.id === p.id ? r * 1.6 : r} fill={colorOf(p.theme)} className="map-dot" strokeWidth={1.5 / view.k} />
                </g>
              );
            })}
            {labelled.map((id) => {
              const c = centroids.get(id);
              if (!c) return null;
              return (
                <text key={id} x={px(c.x)} y={py(c.y) - 16 / view.k} className="map-label" fontSize={13 / view.k} textAnchor="middle" strokeWidth={4 / view.k}>
                  {names.get(id) ?? id}
                </text>
              );
            })}
          </g>
        </svg>
        {hover ? (
          <div
            className="map-tip"
            style={{
              left: `${((px(hover.x) * view.k + view.tx) / W) * 100}%`,
              top: `${((py(hover.y) * view.k + view.ty) / H) * 100}%`,
            }}
          >
            <strong>{names.get(hover.theme) ?? hover.theme}</strong>
            <span>
              {hover.id} · {hover.queue}
            </span>
            <span>
              {fmtDay(hover.day)} · {fmtDuration(hover.durationSeconds)}
              {hover.sentimentEnd ? ` · ends ${hover.sentimentEnd}` : ''}
            </span>
            <em>Click to open the call</em>
          </div>
        ) : null}
        <div className="map-controls">
          <button className="btn" type="button" aria-label="Zoom in" onClick={() => setView((v) => zoomAt(v, 1.5, W / 2, H / 2))}>
            +
          </button>
          <button className="btn" type="button" aria-label="Zoom out" onClick={() => setView((v) => zoomAt(v, 1 / 1.5, W / 2, H / 2))}>
            −
          </button>
          <button className="btn" type="button" disabled={view === HOME} onClick={() => setView(HOME)}>
            Reset
          </button>
        </div>
      </div>
      <div className="map-legend" role="group" aria-label="Highlight a theme on the map">
        {counts.map(([id, n], i) => (
          <button key={id} type="button" className="legend-item" aria-pressed={focus === id} onClick={() => setFocus((f) => (f === id ? '' : id))}>
            <span className="legend-dot" style={{ background: focus ? (focus === id ? FOCUS : OTHER) : (SLOTS[i] ?? OTHER) }} />
            <span className="legend-name">{names.get(id) ?? id}</span>
            <span className="legend-count">{n}</span>
          </button>
        ))}
      </div>
      <p className="small muted">
        Each dot is a call; calls with similar summaries sit close together. Position is a 2-D projection, so distances are approximate. Drag to pan, use
        the buttons or Ctrl/⌘ + scroll to zoom, and pick a theme to highlight it.
      </p>
    </div>
  );
}
