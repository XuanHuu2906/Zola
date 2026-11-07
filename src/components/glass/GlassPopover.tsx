import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Anchored floating panel on the `floating` glass tier. Dismisses on an outside
 * pointer press and on Escape; the caller decides where focus goes afterwards.
 */

export interface GlassPopoverProps {
  open: boolean;
  onClose(): void;
  className?: string;
  label?: string;
  children: ReactNode;
}

export function GlassPopover({ open, onClose, className = '', label, children }: GlassPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open, onClose]);

  if (!open) return null;
  return <div ref={ref} className={`context-menu ${className}`.trim()} aria-label={label}>{children}</div>;
}
