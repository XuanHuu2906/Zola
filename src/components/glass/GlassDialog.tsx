import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Modal glass dialog on top of the native <dialog> element.
 * Owns the three behaviours every modal in this app needs: showModal on mount,
 * a manual Tab trap (the platform one is inconsistent across engines), and
 * focus restoration to the element that opened it.
 */

export interface GlassDialogProps {
  labelledBy: string;
  onClose(): void;
  className?: string;
  children: ReactNode;
}

export function GlassDialog({ labelledBy, onClose, className = '', children }: GlassDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => { dialog.close(); previous?.focus(); };
  }, []);

  return <dialog ref={ref} className={`glass-dialog ${className}`.trim()} aria-labelledby={labelledBy}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const dialog = ref.current!;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'))
        .filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onClick={event => {
      if (event.target !== ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    {children}
  </dialog>;
}
