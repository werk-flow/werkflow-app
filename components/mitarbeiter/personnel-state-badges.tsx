'use client';

import { cn } from '@/lib/utils';
import {
  ACCESS_STATE_LABELS,
  EMPLOYMENT_STATE_LABELS,
  type AccessState,
  type EmploymentState,
} from '@/lib/personnel/types';

// Purple marks planned/parked entities across the app (geparkt, Kalender);
// exited stays neutral, active stays quiet green like the working status dot.
const EMPLOYMENT_STATE_CLASSES: Record<EmploymentState, string> = {
  aktiv:
    'bg-success-soft text-success-soft-foreground',
  geplant:
    'bg-brand-purple/15 text-brand-purple-dark dark:text-brand-purple-light',
  ausgeschieden: 'bg-muted text-muted-foreground',
};

const ACCESS_STATE_CLASSES: Record<AccessState, string> = {
  mit_zugang: 'bg-accent text-accent-foreground',
  eingeladen:
    'bg-warning-soft text-warning-soft-foreground',
  ohne_zugang: 'bg-muted text-muted-foreground',
};

export function EmploymentStateBadge({
  state,
  className,
}: {
  state: EmploymentState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        EMPLOYMENT_STATE_CLASSES[state],
        className
      )}
    >
      {EMPLOYMENT_STATE_LABELS[state]}
    </span>
  );
}

export function AccessStateBadge({
  state,
  className,
}: {
  state: AccessState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        ACCESS_STATE_CLASSES[state],
        className
      )}
    >
      {ACCESS_STATE_LABELS[state]}
    </span>
  );
}
