'use client';

import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status?: 'clocked_out' | 'working' | 'on_break';
  isClockedIn: boolean;
  /** Whether the current working status is based on a pending entry */
  isPending?: boolean;
  /** Whether the viewer has permission to see this member's status */
  canViewStatus?: boolean;
}

export function StatusBadge({
  isClockedIn,
  status,
  isPending = false,
  canViewStatus = true
}: StatusBadgeProps) {
  const effectiveStatus = status ?? (isClockedIn ? 'working' : 'clocked_out');

  // Show "Nicht verfügbar" for members the current user can't view
  if (!canViewStatus) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground/70">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
        Nicht verfügbar
      </span>
    );
  }

  // Pending state (working but awaiting approval)
  if (effectiveStatus === 'working' && isPending) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:text-yellow-300">
        <span className="h-1.5 w-1.5 rounded-full bg-yellow-500 animate-pulse" />
        Arbeitet (ausstehend)
      </span>
    );
  }

  if (effectiveStatus === 'on_break') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:text-yellow-300">
        <span className="h-1.5 w-1.5 rounded-full bg-yellow-500 animate-pulse" />
        Macht Pause
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        effectiveStatus === 'working'
          ? 'bg-green-500/20 text-green-700 dark:text-green-300'
          : 'bg-muted text-muted-foreground'
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          effectiveStatus === 'working'
            ? 'bg-green-500 animate-pulse'
            : 'bg-muted-foreground'
        )}
      />
      {effectiveStatus === 'working' ? 'Arbeitet' : 'Nicht eingestempelt'}
    </span>
  );
}
