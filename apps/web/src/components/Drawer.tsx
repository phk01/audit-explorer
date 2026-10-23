import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useFocusTrap } from './Basics';
import { IconClose } from './Icons';

/** Right-hand inspector drawer with a draggable left edge; the width is persisted. */
export function Drawer({ open, onClose, title, children, ariaLabel, width, setWidth }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; ariaLabel: string; width: number; setWidth: (v: number | ((prev: number) => number)) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const escape = useCallback(() => onClose(), [onClose]);
  useFocusTrap(open, ref, escape);

  useEffect(() => {
    if (!open) return;
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const w = Math.min(Math.max(360, window.innerWidth - e.clientX), Math.max(360, window.innerWidth - 240));
      setWidth(w);
    };
    const onUp = () => { if (dragging.current) { dragging.current = false; document.body.classList.remove('is-resizing'); } };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [open, setWidth]);

  if (!open) return null;
  return (
    <aside className="drawer" style={{ width: `min(${width}px, 100vw)` }} ref={ref} role="dialog" aria-modal="false" aria-label={ariaLabel}>
      <div className="drawer-handle" role="separator" aria-orientation="vertical" aria-label="Resize inspector" tabIndex={0}
        onPointerDown={(e) => { dragging.current = true; document.body.classList.add('is-resizing'); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft') setWidth((w) => Math.min(w + 40, window.innerWidth - 240)); if (e.key === 'ArrowRight') setWidth((w) => Math.max(360, w - 40)); }} />
      <div className="drawer-head">
        <div className="drawer-title">{title}</div>
        <button className="icon-btn" aria-label="Close inspector" onClick={onClose}><IconClose /></button>
      </div>
      <div className="drawer-body">{children}</div>
    </aside>
  );
}
