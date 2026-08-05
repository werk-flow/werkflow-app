import { cn } from '@/lib/utils';
import {
  REQUEST_STATUS_LABELS,
  REQUEST_URGENCY_LABELS,
  type RequestStatus,
  type RequestUrgency,
} from '@/lib/requests/types';

// Quiet, semantic badges: status stays neutral except the two states that
// carry meaning at a glance (converted = done-green, emergency = red).
const STATUS_CLASSES: Record<RequestStatus, string> = {
  offen: 'bg-accent text-accent-foreground',
  in_klaerung:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300',
  umgewandelt:
    'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  geschlossen: 'bg-muted text-muted-foreground',
};

const URGENCY_CLASSES: Record<RequestUrgency, string> = {
  niedrig: 'bg-muted text-muted-foreground',
  normal: 'bg-accent text-accent-foreground',
  hoch: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300',
  notfall: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
        STATUS_CLASSES[status]
      )}
    >
      {REQUEST_STATUS_LABELS[status]}
    </span>
  );
}

export function RequestUrgencyBadge({ urgency }: { urgency: RequestUrgency }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
        URGENCY_CLASSES[urgency]
      )}
    >
      {REQUEST_URGENCY_LABELS[urgency]}
    </span>
  );
}
