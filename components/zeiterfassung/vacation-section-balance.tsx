'use client';

import { Palmtree, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { OwnVacationOverview } from '@/lib/vacation/actions';
import { formatVacationDays } from '@/lib/vacation/balance';

function formatGermanNumber(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

type OwnVacationBalanceSummaryProps = {
  overview: OwnVacationOverview | null;
  balance: OwnVacationOverview['balance'];
  setShowRequestDialog: (open: boolean) => void;
};

export function OwnVacationBalanceSummary({
  overview,
  balance,
  setShowRequestDialog,
}: OwnVacationBalanceSummaryProps) {
  // Non-null exactly when an entitlement is stored for the year.
  const entitlementDays = balance?.entitlementDays ?? null;
  const usedPercentage =
    balance && entitlementDays !== null && entitlementDays > 0
      ? Math.min(Math.round((balance.takenDays / entitlementDays) * 100), 100)
      : 0;

  return (
    <div className="flex items-start gap-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-purple/10">
        <Palmtree className="h-6 w-6 text-brand-purple" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium">Urlaubsanspruch {overview?.year}</span>
          {balance && entitlementDays !== null ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatGermanNumber(balance.takenDays)} von {formatGermanNumber(entitlementDays)} Tagen genommen
            </span>
          ) : null}
        </div>

        {balance && entitlementDays !== null ? (
          <>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-brand-purple transition-all"
                style={{ width: `${usedPercentage}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {balance.pendingDays > 0
                  ? `${formatVacationDays(balance.pendingDays)} angefragt`
                  : 'Keine offenen Anträge'}
              </span>
              <span className="font-semibold text-foreground tabular-nums">
                {formatVacationDays(balance.remainingDays ?? 0)}{' '}
                <span className="font-normal">Resturlaub</span>
              </span>
            </div>
          </>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Kein Urlaubsanspruch hinterlegt. Der Anspruch wird vom Büro in den Beschäftigungs&shy;konditionen
            gepflegt; Anträge sind trotzdem möglich.
          </p>
        )}

        <div className="mt-3">
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setShowRequestDialog(true)}
            disabled={!overview?.employeeRecordId}
          >
            <Plus className="size-3.5" />
            Urlaub beantragen
          </Button>
        </div>
      </div>
    </div>
  );
}
