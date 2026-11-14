'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  History,
  Pencil,
  Plus,
  Siren,
  XCircle,
} from 'lucide-react';

import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { LiveRouteRefresh } from '@/components/shared/live-route-refresh';
import { SubpageHeader } from '@/components/shared/subpage-header';
import { Badge } from '@/components/ui/badge';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow, ListRowActions } from '@/components/ui/list-row';
import { RowActionsMenu, type RowActionMenuItem } from '@/components/ui/row-actions-menu';
import { useServerAction } from '@/hooks/use-server-action';
import { useSettleOnChange, type SettleOnChange } from '@/hooks/use-settle-on-change';
import { useWallClockTick } from '@/hooks/use-wall-clock-tick';
import { describeFailure } from '@/lib/action-messages';
import { addLocalDays } from '@/lib/date-time/berlin';
import { endOnCallShift } from '@/lib/on-call/actions';
import { shiftPhase } from '@/lib/on-call/rules';
import type { OnCallShift, OnCallWeekView } from '@/lib/on-call/types';
import { formatGermanDateRange } from '@/lib/utils';

import { OnCallHandoverDialog } from './on-call-handover-dialog';
import { OnCallHistoryDialog } from './on-call-history-dialog';
import { ON_CALL_FAILURE_MESSAGES, PHASE_BADGES, phoneHref, shiftSpanLabel } from './on-call-labels';
import { OnCallShiftDialog } from './on-call-shift-dialog';

type OpenDialog =
  | { kind: 'plan' }
  | { kind: 'change'; shift: OnCallShift }
  | { kind: 'end'; shift: OnCallShift }
  | { kind: 'history'; shift: OnCallShift }
  | { kind: 'handover' };

const WEEK_PATH = '/service/bereitschaft';

/** The office's week of Bereitschaft: plan, change, end, hand over, and each shift's history. */
export function OnCallWeekContent({
  organizationId,
  week,
}: {
  organizationId: string;
  week: OnCallWeekView;
}): ReactElement {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const settle = useSettleOnChange(week);
  const now = useWallClockTick(60_000);
  const close = () => setDialog(null);
  const sunday = addLocalDays(week.monday, 6);
  // The clock, not the read, decides what runs: a shift that starts while the page is open can be handed over.
  const running = runningShifts(week, now);

  return (
    <div className="space-y-6">
      <LiveRouteRefresh tables={['on_call_shifts', 'profiles', 'employee_records']} />
      <SubpageHeader
        title="Bereitschaft"
        description="Wer außerhalb der Arbeitszeit erreichbar ist. Alle im Team sehen es auf dem Dashboard."
        actions={
          <div className="flex flex-wrap gap-2">
            {running.length > 0 && (
              <Button variant="outline" onClick={() => setDialog({ kind: 'handover' })}>
                <ArrowLeftRight aria-hidden="true" />
                Übergeben
              </Button>
            )}
            <Button onClick={() => setDialog({ kind: 'plan' })}>
              <Plus aria-hidden="true" />
              Bereitschaft planen
            </Button>
          </div>
        }
      />
      <nav aria-label="Woche wählen" className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="icon" aria-label="Vorige Woche">
          <Link href={`${WEEK_PATH}?woche=${addLocalDays(week.monday, -7)}`}>
            <ChevronLeft aria-hidden="true" />
          </Link>
        </Button>
        <p className="min-w-0 text-sm font-medium tabular-nums">
          {formatGermanDateRange(week.monday, sunday)}
        </p>
        <Button asChild variant="outline" size="icon" aria-label="Nächste Woche">
          <Link href={`${WEEK_PATH}?woche=${addLocalDays(week.monday, 7)}`}>
            <ChevronRight aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href={WEEK_PATH}>Diese Woche</Link>
        </Button>
      </nav>
      {week.shifts.length === 0 ? (
        <EmptyState
          icon={Siren}
          title="Noch keine Bereitschaft in dieser Woche"
          description="Plane, wer in dieser Woche außerhalb der Arbeitszeit erreichbar ist."
        />
      ) : (
        <div className="divide-y rounded-lg border">
          {week.shifts.map((shift) => (
            <ShiftRow key={shift.id} shift={shift} now={now} onOpen={setDialog} />
          ))}
        </div>
      )}
      <WeekDialogs
        dialog={dialog}
        organizationId={organizationId}
        week={week}
        settle={settle}
        now={now}
        running={running}
        onClose={close}
      />
    </div>
  );
}

/** The loaded shifts that run at `now`, each once. */
function runningShifts(week: OnCallWeekView, now: number): OnCallShift[] {
  const byId = new Map([...week.running, ...week.shifts].map((shift) => [shift.id, shift]));
  return [...byId.values()].filter((shift) => shiftPhase(shift, new Date(now)) === 'running');
}

function ShiftRow({
  shift,
  now,
  onOpen,
}: {
  shift: OnCallShift;
  now: number;
  onOpen: (dialog: OpenDialog) => void;
}): ReactElement {
  const phase = shiftPhase(shift, new Date(now));
  const badge = PHASE_BADGES[phase];
  const open = phase === 'planned' || phase === 'running';
  const actions: RowActionMenuItem[] = [
    ...(open
      ? [
          {
            label: 'Ändern',
            icon: <Pencil aria-hidden="true" />,
            onSelect: () => onOpen({ kind: 'change', shift }),
          },
          {
            label: phase === 'running' ? 'Jetzt beenden' : 'Absagen',
            icon: <XCircle aria-hidden="true" />,
            onSelect: () => onOpen({ kind: 'end', shift }),
          },
        ]
      : []),
    {
      label: 'Verlauf',
      icon: <History aria-hidden="true" />,
      onSelect: () => onOpen({ kind: 'history', shift }),
    },
  ];
  return (
    <ListRow variant="plain" rowId={shift.id} className="flex items-start gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium tabular-nums">{shiftSpanLabel(shift)}</p>
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {shift.label && <Badge variant="outline">{shift.label}</Badge>}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {shift.members.map((member) => (
            <li key={member.employeeRecordId}>
              {member.name}
              {member.phone && (
                <a
                  className="ml-2 text-primary-text tabular-nums hover:underline"
                  href={phoneHref(member.phone)}
                >
                  {member.phone}
                </a>
              )}
            </li>
          ))}
        </ul>
        {shift.handoverNote && (
          <p className="whitespace-pre-line text-sm text-muted-foreground">{shift.handoverNote}</p>
        )}
      </div>
      <ListRowActions>
        <RowActionsMenu actions={actions} />
      </ListRowActions>
    </ListRow>
  );
}

function WeekDialogs({
  dialog,
  organizationId,
  week,
  settle,
  now,
  running,
  onClose,
}: {
  dialog: OpenDialog | null;
  organizationId: string;
  week: OnCallWeekView;
  settle: SettleOnChange;
  now: number;
  running: OnCallShift[];
  onClose: () => void;
}): ReactElement | null {
  const { showBanner } = useBanner();
  // The confirmation shows the pending state; the hook makes the end a first-frame owner.
  const { run: endShift } = useServerAction(endOnCallShift);
  if (!dialog) return null;
  if (dialog.kind === 'plan' || dialog.kind === 'change')
    return (
      <OnCallShiftDialog
        organizationId={organizationId}
        shift={dialog.kind === 'change' ? dialog.shift : null}
        people={week.people}
        settle={settle}
        onClose={onClose}
      />
    );
  if (dialog.kind === 'handover')
    return (
      <OnCallHandoverDialog
        organizationId={organizationId}
        running={running}
        people={week.people}
        settle={settle}
        onClose={onClose}
      />
    );
  if (dialog.kind === 'history')
    return <OnCallHistoryDialog shift={dialog.shift} people={week.people} onClose={onClose} />;
  const { shift } = dialog;
  const runsNow = shiftPhase(shift, new Date(now)) === 'running';
  return (
    <ConfirmActionDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={runsNow ? 'Bereitschaft jetzt beenden?' : 'Bereitschaft absagen?'}
      description={
        runsNow
          ? 'Die Bereitschaft endet sofort. Ab dann hat niemand mehr aus dieser Bereitschaft Dienst.'
          : 'Die geplante Bereitschaft findet nicht statt. Sie bleibt im Verlauf sichtbar.'
      }
      confirmLabel={runsNow ? 'Jetzt beenden' : 'Absagen'}
      onConfirm={async () => {
        const since = settle.markChange();
        const result = await endShift({ organizationId, shiftId: shift.id, expectedVersion: shift.version });
        if (!result.success)
          return describeFailure(result, ON_CALL_FAILURE_MESSAGES, 'Die Bereitschaft wurde nicht beendet.');
        showBanner({
          variant: 'success',
          message: runsNow ? 'Bereitschaft beendet.' : 'Bereitschaft abgesagt.',
        });
        void settle(since);
        return null;
      }}
    />
  );
}
