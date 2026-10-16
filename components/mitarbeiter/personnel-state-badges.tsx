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
  aktiv: 'bg-success-soft text-success-soft-foreground',
  geplant: 'bg-brand-purple/15 text-brand-purple-dark dark:text-brand-purple-light',
  ausgeschieden: 'bg-muted text-muted-foreground',
};

const ACCESS_STATE_CLASSES: Record<AccessState, string> = {
  mit_zugang: 'bg-accent text-accent-foreground',
  eingeladen: 'bg-warning-soft text-warning-soft-foreground',
  ohne_zugang: 'bg-muted text-muted-foreground',
};

function PersonnelStatePill({ tone, label }: { tone: string; label: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tone)}>
      {label}
    </span>
  );
}

export function EmploymentStateBadge({ state }: { state: EmploymentState }) {
  return <PersonnelStatePill tone={EMPLOYMENT_STATE_CLASSES[state]} label={EMPLOYMENT_STATE_LABELS[state]} />;
}

export function AccessStateBadge({ state }: { state: AccessState }) {
  return <PersonnelStatePill tone={ACCESS_STATE_CLASSES[state]} label={ACCESS_STATE_LABELS[state]} />;
}
