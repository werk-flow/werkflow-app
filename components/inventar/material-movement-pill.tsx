import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function MovementPill({
  tone,
  children,
}: {
  tone: 'planned' | 'take' | 'return';
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
        tone === 'planned' && 'bg-info-soft text-info-soft-foreground',
        tone === 'take' && 'bg-destructive-soft text-destructive-soft-foreground',
        tone === 'return' && 'bg-success-soft text-success-soft-foreground',
      )}
    >
      {children}
    </span>
  );
}
