'use client';

import { WifiOff } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { ClockDeviceView, UnsentTimeEvent } from '@/lib/field-sync/device/time-outbox';
import { TIME_ACTIVITY_LABELS } from '@/lib/time-tracking/types';
import { formatBerlinDateTime } from '@/lib/utils';

// How the clock names the events a phone holds unsent (decision record 0010,
// the 2026-11-11 amendment "the time outbox"): the app's clock sheet and the
// page a phone shows without signal render the same list.

type StoppedStatus = Exclude<UnsentTimeEvent['status'], 'pending' | 'held'>;

/** Why the server refused an event, by its code. An unknown code gets the neutral sentence. */
const REFUSAL_REASONS: Partial<Record<string, string>> = {
  forbidden: 'Du hast für diesen Auftrag oder diese Organisation keine Berechtigung mehr.',
  organization_mismatch:
    'Diese Zeiten gehören zu einer anderen Organisation. Wechsle dorthin und sende sie erneut.',
  closed_period:
    'Der Monat dieser Zeiten ist bereits abgeschlossen. Ein Admin muss ihn zuerst wieder öffnen.',
  outside_recording_window: 'Diese Zeiten sind älter als 7 Tage und können nicht mehr übertragen werden.',
  expired: 'Diese Zeiten sind älter als 7 Tage und können nicht mehr übertragen werden.',
};

/** What changed on the server, by the conflict's code. */
const CONFLICT_REASONS: Partial<Record<string, string>> = {
  version_conflict:
    'Deine Zeiterfassung wurde inzwischen geändert, zum Beispiel vom Büro oder auf einem anderen Gerät. Die Zeiten unten sind nicht erfasst.',
  office_changed:
    'Das Büro hat inzwischen etwas geändert: Der Auftrag ist gesperrt oder abgeschlossen, oder für den Tag ist Urlaub eingetragen. Die Zeiten unten sind nicht erfasst.',
  recovery_required:
    'Deine laufende Erfassung ist ungewöhnlich lang und muss zuerst geprüft werden. Die Zeiten unten sind nicht erfasst.',
};

const STOPPED_REASONS: Record<StoppedStatus, (code: string | null) => string> = {
  failed: (code) =>
    (code && REFUSAL_REASONS[code]) ??
    'Der Server hat diese Zeiten nicht angenommen. Sie sind nicht erfasst.',
  conflict: (code) =>
    (code && CONFLICT_REASONS[code]) ??
    'Der Stand deiner Zeiterfassung hat sich geändert. Die Zeiten unten sind nicht erfasst.',
  correction: () =>
    'Diese Zeiten sind älter als 24 Stunden und werden nicht mehr automatisch erfasst. Beantrage eine Zeitkorrektur, das Büro prüft sie.',
};

/** The state of the first unsent event, which the whole chain shares. */
export function unsentChainStatus(view: ClockDeviceView): Exclude<UnsentTimeEvent['status'], 'held'> {
  const status = view.events[0]?.status;
  return status === undefined || status === 'held' ? 'pending' : status;
}

/** The sentence under the list: what happens next, or why the chain stopped and what the person can do. */
export function unsentChainReason(view: ClockDeviceView): string {
  const status = unsentChainStatus(view);
  if (status === 'pending')
    return 'Deine Zeiten sind auf diesem Gerät gespeichert und werden gesendet, sobald es Netz hat.';
  return STOPPED_REASONS[status](view.events[0]?.code ?? null);
}

/** The badge of an unsent chain: it waits for signal, was refused, or needs the person. */
export function UnsentStatusBadge({ view }: { view: ClockDeviceView }) {
  const status = unsentChainStatus(view);
  if (status === 'pending')
    return (
      <Badge variant="outline" data-clock-unsent={status}>
        <WifiOff aria-hidden="true" />
        Wartet auf Netz
      </Badge>
    );
  return (
    <Badge variant={status === 'failed' ? 'destructive' : 'warning'} data-clock-unsent={status}>
      {status === 'failed' ? 'Nicht übertragen' : status === 'conflict' ? 'Konflikt' : 'Korrektur nötig'}
    </Badge>
  );
}

function eventLabel(event: UnsentTimeEvent): string {
  if (event.action === 'end' || !event.selection) return 'Erfassung beendet';
  return `${TIME_ACTIVITY_LABELS[event.selection.kind]} gestartet`;
}

/** Every unsent event with the time the person captured it, oldest first. */
export function UnsentEventList({ view }: { view: ClockDeviceView }) {
  return (
    <ul className="divide-y rounded-md border" aria-label="Nicht übertragene Zeiten">
      {view.events.map((event) => (
        <li key={event.operationId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="min-w-0 font-medium">{eventLabel(event)}</span>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {formatBerlinDateTime(event.capturedAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
