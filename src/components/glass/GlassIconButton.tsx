import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface GlassIconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  label: string;
  /** Renders aria-expanded when the button controls a popover or disclosure. */
  expanded?: boolean;
  children: ReactNode;
}

export function GlassIconButton({ label, expanded, className = '', children, ...rest }: GlassIconButtonProps) {
  return <button type="button" aria-label={label} aria-expanded={expanded}
    className={`icon-button ${className}`.trim()} {...rest}>{children}</button>;
}
