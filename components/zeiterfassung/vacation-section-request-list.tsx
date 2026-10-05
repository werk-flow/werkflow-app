'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import type { VacationRequestListItem } from '@/lib/vacation/actions';
import { formatVacationDays } from '@/lib/vacation/balance';
import {
  VACATION_PORTION_LABELS,
  VACATION_STATUS_LABELS,
  type VacationRequestStatus,
} from '@/lib/vacation/types';
import { cn, formatGermanDate } from '@/lib/utils';

const STATUS_BADGE_CLASSES: Record<VacationRequestStatus, string> = {
  pending: 'bg-warning-soft text-warning-soft-foreground',
  approved: 'bg-success-soft text-success-soft-foreground',
  rejected: 'bg-destructive/10 text-destructive',
  withdrawn: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
};

function formatRange(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatGermanDate(startDate);
  return `${formatGermanDate(startDate)} – ${formatGermanDate(endDate)}`;
}

type OwnVacationRequestListProps = {
  requests: VacationRequestListItem[];
  busy: { isBusy: (id: string) => boolean };
  handleWithdraw: (request: VacationRequestListItem) => Promise<void>;
  listError: string | null;
};

export function OwnVacationRequestList({
  requests,
  busy,
  handleWithdraw,
  listError,
}: OwnVacationRequestListProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <h4 className="mb-2 text-sm font-medium">Meine Urlaubsanträge</h4>
        <ul className="grid gap-2">
          {requests.map((request) => (
            <li key={request.id} className="rounded-md border px-3 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium tabular-nums">
                      {formatRange(request.startDate, request.endDate)}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                        STATUS_BADGE_CLASSES[request.status],
                      )}
                    >
                      {VACATION_STATUS_LABELS[request.status]}
                    </span>
                    <InlinePending active={busy.isBusy(request.id)} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {VACATION_PORTION_LABELS[request.dayPortion]}
                    {` · ${formatVacationDays(request.totalDays)}`}
                    {request.status === 'pending' && ' (vorläufig)'}
                  </p>
                  {request.status === 'rejected' && request.decisionComment && (
                    <p className="mt-1 text-xs text-muted-foreground">Grund: {request.decisionComment}</p>
                  )}
                  {request.status === 'cancelled' && request.cancellationReason && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Storniert: {request.cancellationReason}
                    </p>
                  )}
                </div>
                {request.status === 'pending' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleWithdraw(request)}
                    disabled={busy.isBusy(request.id)}
                    aria-label={`Urlaubsantrag vom ${formatRange(request.startDate, request.endDate)} zurückziehen`}
                  >
                    Zurückziehen
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <ErrorText className="mt-2">{listError}</ErrorText>
      </CardContent>
    </Card>
  );
}
