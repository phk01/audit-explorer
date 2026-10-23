import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { IconClose } from './Icons';

export function Skeleton({ w, h = 14, className = '', style }: { w?: number | string; h?: number | string; className?: string; style?: CSSProperties }) {
  return <span className={`skeleton ${className}`} style={{ width: w ?? '100%', height: h, ...style }} aria-hidden />;
}

export function SkeletonRows({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="skeleton-rows" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skeleton-row" key={i}>
          {Array.from({ length: cols }).map((__, j) => <Skeleton key={j} w={`${[30, 22, 18, 14, 12, 10][j % 6]}%`} />)}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, text, action, compact }: { title: string; text?: ReactNode; action?: { label: string; to?: string; onClick?: () => void }; compact?: boolean }) {
  return (
    <div className={`empty ${compact ? 'empty-compact' : ''}`}>
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {action && (action.to ? <Link className="btn btn-primary" to={action.to}>{action.label}</Link> : <button className="btn btn-primary" onClick={action.onClick}>{action.label}</button>)}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="empty empty-error" role="alert">
      <div className="empty-title">Something went wrong</div>
      <div className="empty-text mono">{msg}</div>
      {retry && <button className="btn" onClick={retry}>Try again</button>}
    </div>
  );
}

/** Trap Tab focus within a container and restore focus on unmount. */
export function useFocusTrap(active: boolean, ref: React.RefObject<HTMLElement>, onEscape?: () => void) {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(el?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? []).filter((e) => e.offsetParent !== null || e === document.activeElement);
    const first = focusable()[0] ?? el;
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onEscape?.(); return; }
      if (e.key !== 'Tab' || !el) return;
      const f = focusable();
      if (!f.length) { e.preventDefault(); return; }
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    };
    el?.addEventListener('keydown', onKey);
    return () => { el?.removeEventListener('keydown', onKey); prev?.focus?.({ preventScroll: true }); };
  }, [active, ref, onEscape]);
}

export function Dialog({ open, onClose, title, children, footer, width = 520 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useFocusTrap(open, ref, onClose);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} style={{ width: `min(${width}px, calc(100vw - 32px))` }}>
        <div className="modal-head">
          <h2 id={id}>{title}</h2>
          <button className="icon-btn" aria-label="Close dialog" onClick={onClose}><IconClose /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, text, confirmLabel = 'Delete', danger = true, busy }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; text: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean }) {
  return (
    <Dialog open={open} onClose={onClose} title={title} width={440}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button></>}>
      <p>{text}</p>
    </Dialog>
  );
}

export function Kpi({ label, value, sub, tone, to }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'crit' | 'warn' | 'ok' | 'accent'; to?: string }) {
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${tone ? `tone-${tone}` : ''}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </>
  );
  return to ? <Link to={to} className="kpi kpi-link">{body}</Link> : <div className="kpi">{body}</div>;
}

export function Section({ title, children, right, className = '', id }: { title?: ReactNode; children: ReactNode; right?: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`card ${className}`} id={id}>
      {(title || right) && <div className="card-head"><h3>{title}</h3>{right && <div className="card-right">{right}</div>}</div>}
      {children}
    </section>
  );
}

/** A small horizontal bar list (value, count) used for top-N panels. */
export function BarList({ items, max, render, onClick, selected, counts = true }: {
  items: { value: string; count: number; label?: string }[]; max?: number;
  render?: (item: { value: string; count: number; label?: string }) => ReactNode;
  onClick?: (item: { value: string; count: number; label?: string }) => void;
  selected?: (value: string) => boolean; counts?: boolean;
}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.count));
  if (!items.length) return <div className="muted small" style={{ padding: '4px 0' }}>None</div>;
  return (
    <ul className="barlist">
      {items.map((it) => {
        const inner = (
          <>
            <span className="barlist-label">{render ? render(it) : (it.label ?? it.value)}</span>
            {counts && <span className="barlist-count mono">{it.count.toLocaleString('en-US')}</span>}
            <span className="barlist-bar" style={{ width: `${Math.max(2, (it.count / top) * 100)}%` }} aria-hidden />
          </>
        );
        return (
          <li key={it.value} className={selected?.(it.value) ? 'is-selected' : ''}>
            {onClick ? <button type="button" className="barlist-btn" onClick={() => onClick(it)} aria-pressed={selected?.(it.value)}>{inner}</button> : <div className="barlist-btn">{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export function Collapsible({ title, children, defaultOpen = false, small }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; small?: boolean }) {
  return (
    <details className={`collapsible ${small ? 'collapsible-small' : ''}`} open={defaultOpen}>
      <summary>{title}</summary>
      <div className="collapsible-body">{children}</div>
    </details>
  );
}

/** Editable list of short tokens (domains, countries). */
export function ChipInput({ values, onChange, placeholder, transform, validate, label }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string; transform?: (s: string) => string; validate?: (s: string) => boolean; label: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const add = (raw: string) => {
    const parts = raw.split(/[\s,;]+/).map((s) => (transform ? transform(s.trim()) : s.trim())).filter(Boolean);
    const next = [...values];
    for (const p of parts) if ((!validate || validate(p)) && !next.includes(p)) next.push(p);
    onChange(next);
  };
  return (
    <div className="chipinput" onClick={() => inputRef.current?.focus()}>
      {values.map((v) => (
        <span key={v} className="chip chip-editable">{v}<button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}><IconClose size={12} /></button></span>
      ))}
      <input ref={inputRef} aria-label={label} placeholder={values.length ? '' : placeholder}
        onKeyDown={(e) => {
          const el = e.currentTarget;
          if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && el.value.trim()) { e.preventDefault(); add(el.value); el.value = ''; }
          else if (e.key === 'Backspace' && !el.value && values.length) onChange(values.slice(0, -1));
        }}
        onBlur={(e) => { if (e.currentTarget.value.trim()) { add(e.currentTarget.value); e.currentTarget.value = ''; } }} />
    </div>
  );
}
