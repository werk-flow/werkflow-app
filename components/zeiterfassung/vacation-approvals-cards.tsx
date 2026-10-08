'use client';

import { Check, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { InlinePending } from '@/components/ui/inline-pending';
import type { ApproverVacationRequest } from '@/lib/vacation/actions';
import { formatVacationDays } from '@/lib/vacation/balance';
import { VACATION_PORTION_LABELS } from '@/lib/vacation/types';
import type { VacationReasonDialogState } from './use-vacation-approvals';
import { formatGermanDate, formatGermanDateRange } from '@/lib/utils';

type VacationApprovalPendingCardProps = {
  item: ApproverVacationRequest;
  busy: { isBusy: (id: string) => boolean };
  setReasonDialog: (state: VacationReasonDialogState) => void;
  handleApprove: (item: ApproverVacationRequest) => Promise<void>;
};

export function VacationApprovalPendingCard({
  item,
  busy,
  setReasonDialog,
  handleApprove,
}: VacationApprovalPendingCardProps) {
  return (
    <Card className="py-0" data-vacation-request={item.request.id}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              {item.personName}
              <InlinePending active={busy.isBusy(item.request.id)} />
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
              {formatGermanDateRange(item.request.startDate, item.request.endDate)}
              {` · ${VACATION_PORTION_LABELS[item.request.dayPortion]}`}
              {` · ${formatVacationDays(item.totalDays)}`}
            </p>
            {item.balance ? (
              item.balance.entitlementDays !== null ? (
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  Resturlaub {item.balance.year}: {formatVacationDays(item.balance.remainingDays ?? 0)} von{' '}
                  {formatVacationDays(item.balance.entitlementDays)}
                </p>
              ) : (
                <p className="mt-0.5 text-xs font-medium text-warning-text">
                  Kein Urlaubsanspruch hinterlegt – Anspruch in der Personalakte unter Beschäftigung pflegen.
                </p>
              )
            ) : null}
            {item.request.comment && (
              <p className="mt-1 text-xs text-muted-foreground">Notiz: {item.request.comment}</p>
            )}
            {item.hasAbsenceOverlap && (
              <p className="mt-1 text-xs font-medium text-warning-text">
                Hinweis: Für diese Person liegt im beantragten Zeitraum eine weitere Abwesenheit vor.
              </p>
            )}
            {item.assignedJobsInRange.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Im Zeitraum eingeplant:{' '}
                {item.assignedJobsInRange
                  .map((job) => `${job.title} (${formatGermanDate(job.plannedDate)})`)
                  .join(', ')}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setReasonDialog({ mode: 'reject', item })}
              disabled={busy.isBusy(item.request.id)}
              aria-label={`Urlaubsantrag von ${item.personName} ablehnen`}
            >
              <X className="size-3.5" />
              Ablehnen
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => void handleApprove(item)}
              disabled={busy.isBusy(item.request.id)}
              aria-label={`Urlaubsantrag von ${item.personName} genehmigen`}
            >
              <Check className="size-3.5" />
              Genehmigen
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type VacationApprovalApprovedListProps = {
  approved: ApproverVacationRequest[];
  busy: { isBusy: (id: string) => boolean };
  setReasonDialog: (state: VacationReasonDialogState) => void;
};

export function VacationApprovalApprovedList({
  approved,
  busy,
  setReasonDialog,
}: VacationApprovalApprovedListProps) {
  return (
    <div className="space-y-2">
      <h4 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Genehmigter Urlaub
      </h4>
      {approved.map((item) => (
        <Card key={item.request.id} className="py-0">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                {item.personName}
                <InlinePending active={busy.isBusy(item.request.id)} />
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatGermanDateRange(item.request.startDate, item.request.endDate)}
                {` · ${formatVacationDays(item.totalDays)}`}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setReasonDialog({ mode: 'cancel', item })}
              disabled={busy.isBusy(item.request.id)}
              aria-label={`Genehmigten Urlaub von ${item.personName} stornieren`}
            >
              <Undo2 className="size-3.5" />
              Stornieren
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
