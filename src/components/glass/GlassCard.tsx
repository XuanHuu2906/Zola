import type { HTMLAttributes } from 'react';

export function GlassCard({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`glass-card ${className}`.trim()} {...rest}>{children}</div>;
}
