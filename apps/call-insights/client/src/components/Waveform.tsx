import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { CallSegment, KeyMoment } from '../../../shared/insights';
import { fmtTime } from '../lib/format';

const BUCKETS = 480;
export type Peaks = { agent: number[]; customer: number[]; source: 'audio' | 'transcript' };

function bucketPeaks(data: Float32Array, buckets = BUCKETS) {
  const size = Math.max(1, Math.floor(data.length / buckets));
  const out: number[] = [];
  for (let b = 0; b < buckets; b++) {
    let peak = 0;
    const end = Math.min(data.length, (b + 1) * size);
    for (let i = b * size; i < end; i += 8) peak = Math.max(peak, Math.abs(data[i]));
    out.push(peak);
  }
  const max = Math.max(...out, 1e-6);
  return out.map((v) => Math.min(1, v / max));
}

/** Energy inside a role's turns, used to tell which stereo channel carries which speaker. */
function roleEnergy(peaks: number[], segments: CallSegment[], role: string, duration: number) {
  let sum = 0;
  for (const s of segments.filter((x) => x.role === role))
    for (let b = Math.floor((s.start / duration) * peaks.length); b < Math.ceil((s.end / duration) * peaks.length) && b < peaks.length; b++) sum += peaks[b];
  return sum;
}

/** A deterministic waveform shaped by transcript timing, for calls without original audio. */
export function transcriptPeaks(segments: CallSegment[], duration: number): Peaks {
  const lane = (role: string) =>
    Array.from({ length: BUCKETS }, (_, b) => {
      const t = ((b + 0.5) / BUCKETS) * duration;
      const seg = segments.find((s) => s.role === role && t >= s.start && t <= s.end);
      if (!seg) return 0.03;
      const wobble = Math.abs(Math.sin(b * 1.7 + seg.idx * 3.1) * Math.cos(b * 0.31 + seg.idx));
      return 0.25 + 0.7 * wobble;
    });
  return { agent: lane('agent'), customer: lane('customer'), source: 'transcript' };
}

/** Decode the original recording once and reduce each channel to peaks. */
export function useAudioPeaks(url: string | null, segments: CallSegment[], duration: number) {
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const context = new AudioContext();
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Audio unavailable (${r.status})`);
        return r.arrayBuffer();
      })
      .then((buffer) => context.decodeAudioData(buffer))
      .then((audio) => {
        if (cancelled) return;
        const channels = Array.from({ length: Math.min(2, audio.numberOfChannels) }, (_, c) => bucketPeaks(audio.getChannelData(c)));
        if (channels.length < 2) {
          setPeaks({ agent: channels[0], customer: channels[0], source: 'audio' });
          return;
        }
        // HarperValleyBank stores one speaker per channel; match channels to roles by energy.
        const [a, b] = channels;
        const firstIsAgent = roleEnergy(a, segments, 'agent', duration) - roleEnergy(a, segments, 'customer', duration) >= roleEnergy(b, segments, 'agent', duration) - roleEnergy(b, segments, 'customer', duration);
        setPeaks({ agent: firstIsAgent ? a : b, customer: firstIsAgent ? b : a, source: 'audio' });
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Audio could not be analysed.'))
      .finally(() => void context.close());
    return () => {
      cancelled = true;
    };
  }, [url, segments, duration]);
  return { peaks, error };
}

const SENTIMENT_COLOR: Record<string, string> = { negative: '#e5444e', neutral: '#8b8c96', positive: '#7fb79a' };

export function Waveform({
  peaks,
  duration,
  time,
  moments,
  sentimentStart,
  sentimentEnd,
  onSeek,
}: {
  peaks: Peaks;
  duration: number;
  time: number;
  moments: KeyMoment[];
  sentimentStart: string | null;
  sentimentEnd: string | null;
  onSeek: (seconds: number) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const [hover, setHover] = useState<number | null>(null);
  const width = BUCKETS * 2;
  const played = Math.round((time / duration) * BUCKETS);
  const toTime = (event: PointerEvent<SVGSVGElement>) => {
    const rect = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((event.clientX - rect.left) / rect.width) * duration));
  };
  const bars = useMemo(
    () =>
      peaks.agent.map((_, b) => ({
        b,
        agent: Math.max(1, peaks.agent[b] * 40),
        customer: Math.max(1, peaks.customer[b] * 40),
      })),
    [peaks]
  );
  function onKey(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === 'ArrowRight') onSeek(Math.min(duration, time + 5));
    else if (event.key === 'ArrowLeft') onSeek(Math.max(0, time - 5));
    else return;
    event.preventDefault();
  }
  return (
    <div className="waveform">
      <div className="wave-labels" aria-hidden="true">
        <span className="who-a">Agent</span>
        <span className="who-c">Customer</span>
      </div>
      <div className="wave-body">
        <svg
          ref={ref}
          viewBox={`0 0 ${width} 100`}
          preserveAspectRatio="none"
          role="slider"
          tabIndex={0}
          aria-label="Call timeline. Agent above the line, customer below. Arrow keys move 5 seconds."
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${fmtTime(time)} of ${fmtTime(duration)}`}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            onSeek(toTime(e));
          }}
          onPointerMove={(e) => {
            setHover(toTime(e));
            if (dragging.current) onSeek(toTime(e));
          }}
          onPointerUp={() => (dragging.current = false)}
          onPointerLeave={() => setHover(null)}
        >
          <line x1={0} x2={width} y1={50} y2={50} className="wave-axis" />
          {bars.map(({ b, agent, customer }) => (
            <g key={b} className={b <= played ? 'played' : undefined}>
              <rect className="wave-agent" x={b * 2} y={50 - agent - 1} width={1.3} height={agent} />
              <rect className="wave-cust" x={b * 2} y={51} width={1.3} height={customer} />
            </g>
          ))}
          {hover != null ? <line className="wave-hover" x1={(hover / duration) * width} x2={(hover / duration) * width} y1={0} y2={100} /> : null}
          <line className="wave-playhead" x1={(time / duration) * width} x2={(time / duration) * width} y1={0} y2={100} />
        </svg>
        <div className="wave-moments">
          {moments.map((m) => (
            <button
              key={`${m.label}:${m.start}`}
              type="button"
              className={`wave-moment${m.grounded ? '' : ' ungrounded'}`}
              style={{ left: `${(m.start / duration) * 100}%` }}
              onClick={() => onSeek(m.start)}
              title={`${fmtTime(m.start)} · ${m.label}`}
            >
              <span className="sr-only">
                Key moment at {fmtTime(m.start)}: {m.label}
              </span>
            </button>
          ))}
          {hover != null ? (
            <span className="wave-tip" style={{ left: `${(hover / duration) * 100}%` }}>
              {fmtTime(hover)}
            </span>
          ) : null}
        </div>
        {sentimentStart || sentimentEnd ? (
          <div
            className="sentiment-strip"
            style={{
              background: `linear-gradient(90deg, ${SENTIMENT_COLOR[sentimentStart ?? 'neutral'] ?? '#8b8c96'}, ${SENTIMENT_COLOR[sentimentEnd ?? 'neutral'] ?? '#8b8c96'})`,
            }}
          >
            <span>Customer · {sentimentStart ?? 'unknown'}</span>
            <span>AI sentiment, start → end · {sentimentEnd ?? 'unknown'}</span>
          </div>
        ) : null}
      </div>
      <p className="small muted wave-source">
        {peaks.source === 'audio' ? 'Waveform from the original recording.' : 'Shape from transcript timing; no original recording in this mode.'} Click or drag to
        seek; markers are key moments.
      </p>
    </div>
  );
}
