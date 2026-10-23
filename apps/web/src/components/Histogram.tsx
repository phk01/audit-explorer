import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Histogram as HistogramData, HistogramBucket } from '@audit/core';
import { useTime } from '../lib/time';
import { fmtInt } from '../lib/format';

const UNIT_MS = { hour: 36e5, day: 864e5, week: 6048e5 } as const;

export function bucketEnd(ts: string, unit: HistogramData['unit']): string {
  return new Date(new Date(ts).getTime() + UNIT_MS[unit] - 1000).toISOString();
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null!);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => { const cw = entries[0]?.contentRect.width; if (cw) setW(Math.max(120, cw)); });
    ro.observe(el);
    setW(Math.max(120, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Fill missing buckets so the x-axis is continuous. */
function densify(data: HistogramData): HistogramBucket[] {
  const b = data.buckets;
  if (b.length < 2) return b;
  const step = UNIT_MS[data.unit];
  const out: HistogramBucket[] = [];
  let t = new Date(b[0].ts).getTime();
  const end = new Date(b[b.length - 1].ts).getTime();
  const byTs = new Map(b.map((x) => [new Date(x.ts).getTime(), x]));
  let guard = 0;
  while (t <= end && guard++ < 5000) {
    out.push(byTs.get(t) ?? { ts: new Date(t).toISOString(), count: 0, failed: 0 });
    t += step;
  }
  return out.length > b.length ? out : b;
}

export function Histogram({ data, height = 120, onBucketClick, compact, selectedRange, loading }: {
  data: HistogramData | undefined; height?: number; compact?: boolean; loading?: boolean;
  onBucketClick?: (from: string, to: string, bucket: HistogramBucket) => void;
  selectedRange?: { from?: string; to?: string };
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const t = useTime();
  const [hover, setHover] = useState<number | null>(null);
  const buckets = useMemo(() => (data ? densify(data) : []), [data]);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const padL = compact ? 0 : 36, padR = 0, padT = 8, padB = compact ? 16 : 20;
  const innerW = Math.max(10, width - padL - padR), innerH = height - padT - padB;
  const n = buckets.length;
  const slot = n ? innerW / n : innerW;
  const gap = Math.min(3, slot * 0.2);
  const barW = Math.max(1, slot - gap);

  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / (data?.unit === 'hour' ? 56 : 74)))));
  const fmtLabel = (ts: string) => (data?.unit === 'hour' ? t.dateTime(ts, { seconds: false }).slice(5) : t.date(ts).slice(5));
  const yTicks = compact ? [] : [0, 0.5, 1].map((f) => Math.round(max * f));

  if (!data && loading) return <div ref={ref} className="hist hist-loading" style={{ height }}><span className="skeleton" style={{ width: '100%', height: height - 20 }} /></div>;
  if (!buckets.length) return <div ref={ref} className="hist hist-empty muted small" style={{ height }}>No timeline data</div>;

  const h = hover != null ? buckets[hover] : null;
  const selFrom = selectedRange?.from ? new Date(selectedRange.from).getTime() : null;
  const selTo = selectedRange?.to ? new Date(selectedRange.to).getTime() : null;

  return (
    <div ref={ref} className={`hist ${loading ? 'is-refreshing' : ''}`} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={`Activity per ${data?.unit}: ${fmtInt(buckets.reduce((a, b) => a + b.count, 0))} events`} onMouseLeave={() => setHover(null)}>
        {yTicks.map((v, i) => {
          const y = padT + innerH - (v / max) * innerH;
          return <g key={i}><line x1={padL} x2={width - padR} y1={y} y2={y} className="hist-grid" /><text x={padL - 6} y={y + 3} className="hist-ytick" textAnchor="end">{v >= 10_000 ? `${Math.round(v / 1000)}k` : v}</text></g>;
        })}
        {buckets.map((b, i) => {
          const x = padL + i * slot + gap / 2;
          const hh = (b.count / max) * innerH;
          const fh = (b.failed / max) * innerH;
          const y = padT + innerH - hh;
          const bt = new Date(b.ts).getTime();
          const inSel = selFrom != null || selTo != null ? (selFrom == null || bt + UNIT_MS[data!.unit] > selFrom) && (selTo == null || bt <= selTo) : true;
          return (
            <g key={b.ts} className={`hist-bar ${hover === i ? 'is-hover' : ''} ${inSel ? '' : 'is-dim'}`}
              onMouseEnter={() => setHover(i)} onClick={() => onBucketClick?.(b.ts, bucketEnd(b.ts, data!.unit), b)} style={{ cursor: onBucketClick ? 'pointer' : 'default' }}>
              <rect x={padL + i * slot} y={padT} width={slot} height={innerH} fill="transparent" />
              <rect x={x} y={y} width={barW} height={Math.max(hh, b.count ? 1 : 0)} rx={barW > 4 ? 1.5 : 0} className="hist-rect" />
              {b.failed > 0 && <rect x={x} y={padT + innerH - fh} width={barW} height={Math.max(fh, 1)} rx={barW > 4 ? 1.5 : 0} className="hist-rect-failed" />}
            </g>
          );
        })}
        {buckets.map((b, i) => (i % labelEvery === 0 && (i + labelEvery / 2 < n || n <= 2)) ? (
          <text key={'l' + b.ts} x={padL + i * slot + 2} y={height - 5} className="hist-xtick">{fmtLabel(b.ts)}</text>
        ) : null)}
        <line x1={padL} x2={width - padR} y1={padT + innerH + 0.5} y2={padT + innerH + 0.5} className="hist-axis" />
      </svg>
      {h && hover != null && (
        <div className="hist-tip" style={{ left: Math.min(Math.max(0, padL + hover * slot + slot / 2 - 90), width - 180) }} role="tooltip">
          <div className="mono small">{t.dateTime(h.ts, { seconds: false })}{data?.unit === 'day' ? '' : data?.unit === 'week' ? ' (week)' : ''}</div>
          <div><strong>{fmtInt(h.count)}</strong> events{h.failed ? <> · <span className="tone-crit">{fmtInt(h.failed)} failed</span></> : null}</div>
          {onBucketClick && <div className="muted small">Click to filter</div>}
        </div>
      )}
    </div>
  );
}
