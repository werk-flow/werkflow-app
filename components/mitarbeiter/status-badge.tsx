'use client';

import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  isClockedIn: boolean;
}

export function StatusBadge({ isClockedIn }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        isClockedIn
          ? 'bg-green-500/20 text-green-700 dark:text-green-300'
          : 'bg-muted text-muted-foreground'
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          isClockedIn ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'
        )}
      />
      {isClockedIn ? 'Arbeitet' : 'Nicht eingestempelt'}
    </span>
  );
}
