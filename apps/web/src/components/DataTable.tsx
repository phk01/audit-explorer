import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { SkeletonRows, EmptyState } from './Basics';

export interface Column<T> {
  id: string;
  header: ReactNode;
  width: string; // CSS grid track, e.g. '160px' or 'minmax(200px,1.4fr)'
  cell: (row: T) => ReactNode;
  className?: string;
  align?: 'left' | 'right';
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  rowHeight?: number;
  selectedKey?: string | number | null;
  onSelect?: (row: T, index: number) => void;
  onOpen?: (row: T, index: number) => void;
  onEndReached?: () => void;
  hasMore?: boolean;
  loading?: boolean;
  fetchingMore?: boolean;
  empty?: ReactNode;
  rowClassName?: (row: T) => string;
  ariaLabel: string;
  /** Fill remaining height of a flex parent (default) or use a fixed max height. */
  maxHeight?: number | string;
  footer?: ReactNode;
}

/** Virtualised, keyboard-navigable table rendered with CSS grid rows (role=grid semantics). */
export function DataTable<T>({ rows, columns, rowKey, rowHeight = 44, selectedKey, onSelect, onOpen, onEndReached, hasMore, loading, fetchingMore, empty, rowClassName, ariaLabel, maxHeight, footer }: DataTableProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const template = useMemo(() => columns.map((c) => c.width).join(' '), [columns]);
  // minimum width of the row grid so header and rows share one horizontal scroll
  const minWidth = useMemo(() => columns.reduce((a, c) => { const m = c.width.match(/^(?:minmax\()?\s*(\d+(?:\.\d+)?)px/); return a + (m ? Number(m[1]) : 120); }, 0), [columns]);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => rowHeight, overscan: 12, scrollMargin: 32 });
  const items = virtualizer.getVirtualItems();

  // infinite scroll
  useEffect(() => {
    const last = items[items.length - 1];
    if (!last || !hasMore || fetchingMore || !onEndReached) return;
    if (last.index >= rows.length - 15) onEndReached();
  }, [items, rows.length, hasMore, fetchingMore, onEndReached]);

  const selectedIndex = useMemo(() => (selectedKey == null ? -1 : rows.findIndex((r) => rowKey(r) === selectedKey)), [rows, rowKey, selectedKey]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (!rows.length) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    let next = selectedIndex;
    if (e.key === 'ArrowDown') next = Math.min(rows.length - 1, selectedIndex + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, selectedIndex - 1);
    else if (e.key === 'PageDown') next = Math.min(rows.length - 1, selectedIndex + 15);
    else if (e.key === 'PageUp') next = Math.max(0, selectedIndex - 15);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = rows.length - 1;
    else if (e.key === 'Enter' && selectedIndex >= 0) { e.preventDefault(); onOpen?.(rows[selectedIndex], selectedIndex); return; }
    else return;
    e.preventDefault();
    if (next !== selectedIndex && next >= 0) {
      onSelect?.(rows[next], next);
      virtualizer.scrollToIndex(next, { align: 'auto' });
    }
  }, [rows, selectedIndex, onSelect, onOpen, virtualizer]);

  const style = maxHeight ? { maxHeight } : undefined;
  const HEAD_H = 32;

  return (
    <div className="dt" style={style}>
      <div ref={parentRef} className="dt-scroll" role="grid" aria-label={ariaLabel} aria-rowcount={rows.length} tabIndex={0} onKeyDown={onKeyDown} aria-busy={loading || fetchingMore}>
        <div className="dt-head" role="row" style={{ gridTemplateColumns: template, height: HEAD_H, minWidth }}>
          {columns.map((c) => <div key={c.id} role="columnheader" className={`dt-th ${c.align === 'right' ? 'is-right' : ''} ${c.className ?? ''}`}>{c.header}</div>)}
        </div>
        {loading && !rows.length ? <SkeletonRows rows={10} cols={Math.min(columns.length, 6)} /> : !rows.length ? (empty ?? <EmptyState compact title="No rows" />) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth }}>
            {items.map((vi) => {
              const row = rows[vi.index];
              const key = rowKey(row);
              const sel = key === selectedKey;
              return (
                <div key={key} role="row" aria-rowindex={vi.index + 1} aria-selected={sel} data-index={vi.index} ref={virtualizer.measureElement}
                  className={`dt-row ${sel ? 'is-selected' : ''} ${rowClassName?.(row) ?? ''}`}
                  style={{ gridTemplateColumns: template, transform: `translateY(${vi.start - virtualizer.options.scrollMargin}px)` }}
                  onClick={() => { onSelect?.(row, vi.index); onOpen?.(row, vi.index); }}>
                  {columns.map((c) => <div key={c.id} role="gridcell" className={`dt-td ${c.align === 'right' ? 'is-right' : ''} ${c.className ?? ''}`}>{c.cell(row)}</div>)}
                </div>
              );
            })}
          </div>
        )}
        {fetchingMore && <div className="dt-more"><span className="skeleton" style={{ width: 160, height: 12 }} /></div>}
        {!hasMore && rows.length > 50 && !fetchingMore && <div className="dt-more muted small">End of results</div>}
      </div>
      {footer && <div className="dt-foot">{footer}</div>}
    </div>
  );
}

/** Plain (non-virtualised) table for small lists. */
export function SimpleTable<T>({ rows, columns, rowKey, onRowClick, ariaLabel, empty, dense }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string | number; onRowClick?: (r: T) => void; ariaLabel: string; empty?: ReactNode; dense?: boolean }) {
  if (!rows.length) return <>{empty ?? <div className="muted small" style={{ padding: '8px 0' }}>None</div>}</>;
  return (
    <div className="table-wrap">
      <table className={`table ${dense ? 'table-dense' : ''} ${onRowClick ? 'table-clickable' : ''}`} aria-label={ariaLabel}>
        <thead><tr>{columns.map((c) => <th key={c.id} scope="col" className={`${c.align === 'right' ? 'is-right' : ''} ${c.className ?? ''}`} style={{ width: c.width.endsWith('px') ? c.width : undefined }}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} tabIndex={onRowClick ? 0 : undefined} onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r); } : undefined}>
              {columns.map((c) => <td key={c.id} className={`${c.align === 'right' ? 'is-right' : ''} ${c.className ?? ''}`}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
