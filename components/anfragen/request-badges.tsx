import { cn } from '@/lib/utils';
import {
  REQUEST_STATUS_LABELS,
  REQUEST_URGENCY_LABELS,
  type RequestStatus,
  type RequestUrgency,
} from '@/lib/requests/types';

// Quiet, semantic badges: status stays neutral except the two states that
// carry meaning at a glance (converted or attached = done-green, emergency = red).
const STATUS_CLASSES: Record<RequestStatus, string> = {
  offen: 'bg-accent text-accent-foreground',
  in_klaerung: 'bg-warning-soft text-warning-soft-foreground',
  umgewandelt: 'bg-success-soft text-success-soft-foreground',
  geschlossen: 'bg-muted text-muted-foreground',
  hinzugefuegt: 'bg-success-soft text-success-soft-foreground',
};

const URGENCY_CLASSES: Record<RequestUrgency, string> = {
  niedrig: 'bg-muted text-muted-foreground',
  normal: 'bg-accent text-accent-foreground',
  hoch: 'bg-warning-soft text-warning-soft-foreground',
  notfall: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
};

function RequestPill({ tone, label }: { tone: string; label: string }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium', tone)}
    >
      {label}
    </span>
  );
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return <RequestPill tone={STATUS_CLASSES[status]} label={REQUEST_STATUS_LABELS[status]} />;
}

/** An open request whose promised callback has passed. */
export function CallbackOverdueBadge() {
  return (
    <RequestPill
      tone="bg-destructive/10 text-destructive dark:bg-destructive/20"
      label="Rückruf überfällig"
    />
  );
}

export function RequestUrgencyBadge({ urgency }: { urgency: RequestUrgency }) {
  return <RequestPill tone={URGENCY_CLASSES[urgency]} label={REQUEST_URGENCY_LABELS[urgency]} />;
}

/**
 * The detail header's status and urgency, kept on one line: `PageHeader`
 * wraps each top-level badge on its own, so this group wraps as a whole.
 */
export function RequestHeaderBadges({ status, urgency }: { status: RequestStatus; urgency: RequestUrgency }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <RequestStatusBadge status={status} />
      <RequestUrgencyBadge urgency={urgency} />
    </span>
  );
}
