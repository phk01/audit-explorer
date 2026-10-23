import { useMemo, useState } from 'react';
import { usePrefs } from '../lib/prefs';
import { localOffsetHours } from '../lib/time';
import { fmtInt } from '../lib/format';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 7×24 weekday × hour heatmap. Input is Mon..Sun × hour UTC; shifted when the Local time zone is selected. */
export function Heatmap({ data, onCellClick }: { data: number[][]; onCellClick?: (dow: number, hour: number) => void }) {
  const { tz } = usePrefs();
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const grid = useMemo(() => {
    const out: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    const shift = tz === 'local' ? localOffsetHours() : 0;
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
      const v = data[d]?.[h] ?? 0;
      if (!v) continue;
      let nh = h + shift, nd = d;
      if (nh >= 24) { nh -= 24; nd = (d + 1) % 7; } else if (nh < 0) { nh += 24; nd = (d + 6) % 7; }
      out[nd][nh] += v;
    }
    return out;
  }, [data, tz]);
  const max = Math.max(1, ...grid.flat());
  const total = grid.flat().reduce((a, b) => a + b, 0);
  const cell = 22, gapPx = 2, labelW = 34, top = 18;
  const w = labelW + 24 * (cell + gapPx), h = top + 7 * (cell + gapPx);
  return (
    <div className="heatmap-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ maxWidth: w }} role="img" aria-label={`Activity by weekday and hour (${tz === 'utc' ? 'UTC' : 'local time'}), ${fmtInt(total)} events`} onMouseLeave={() => setHover(null)}>
        {Array.from({ length: 24 }).map((_, hh) => hh % 3 === 0 ? <text key={hh} x={labelW + hh * (cell + gapPx) + 2} y={12} className="heat-label">{String(hh).padStart(2, '0')}</text> : null)}
        {grid.map((row, d) => (
          <g key={d}>
            <text x={0} y={top + d * (cell + gapPx) + cell - 6} className="heat-label">{DAYS[d]}</text>
            {row.map((v, hh) => {
              const a = v ? 0.12 + 0.88 * Math.sqrt(v / max) : 0;
              return (
                <rect key={hh} x={labelW + hh * (cell + gapPx)} y={top + d * (cell + gapPx)} width={cell} height={cell} rx={3}
                  className={`heat-cell ${hover?.d === d && hover?.h === hh ? 'is-hover' : ''}`} style={{ fillOpacity: a }}
                  onMouseEnter={() => setHover({ d, h: hh })} onClick={() => onCellClick?.(d, hh)}>
                  <title>{`${DAYS[d]} ${String(hh).padStart(2, '0')}:00 — ${fmtInt(v)} events`}</title>
                </rect>
              );
            })}
          </g>
        ))}
      </svg>
      <div className="heatmap-legend small muted">
        {hover ? <span>{DAYS[hover.d]} {String(hover.h).padStart(2, '0')}:00–{String(hover.h).padStart(2, '0')}:59 · <strong className="fg">{fmtInt(grid[hover.d][hover.h])}</strong> events</span> : <span>Hours in {tz === 'utc' ? 'UTC' : 'local time'} · square-root colour scale</span>}
      </div>
    </div>
  );
}
