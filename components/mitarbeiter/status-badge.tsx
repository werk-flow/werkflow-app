'use client';

import { cn } from '@/lib/utils';
import { HIDDEN_STATUS_HINT, type StatusVisibility } from './member-status-visibility';

interface StatusBadgeProps {
  status?: 'clocked_out' | 'working' | 'on_break' | undefined;
  isClockedIn: boolean;
  /** Whether the current working status is based on a pending entry */
  isPending?: boolean;
  visibility?: StatusVisibility | undefined;
}

export function StatusBadge({
  isClockedIn,
  status,
  isPending = false,
  visibility = 'visible',
}: StatusBadgeProps) {
  const effectiveStatus = status ?? (isClockedIn ? 'working' : 'clocked_out');

  // A neutral label, never one that reads as „this person is unavailable“.
  if (visibility !== 'visible') {
    const hint = visibility === 'hidden' ? HIDDEN_STATUS_HINT : undefined;
    return (
      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground"
        title={hint}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
        {visibility === 'hidden' ? 'Status nicht sichtbar' : 'Status nicht geladen'}
        {hint ? <span className="sr-only">. {hint}</span> : null}
      </span>
    );
  }

  // Pending state (working but awaiting approval)
  if (effectiveStatus === 'working' && isPending) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-soft-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-warning animate-live" />
        Arbeitet (ausstehend)
      </span>
    );
  }

  if (effectiveStatus === 'on_break') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-soft-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-warning animate-live" />
        Macht Pause
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        effectiveStatus === 'working'
          ? 'bg-success-soft text-success-soft-foreground'
          : 'bg-muted text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          effectiveStatus === 'working' ? 'bg-success animate-live' : 'bg-muted-foreground',
        )}
      />
      {effectiveStatus === 'working' ? 'Arbeitet' : 'Nicht eingestempelt'}
    </span>
  );
}
