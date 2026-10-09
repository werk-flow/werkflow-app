'use client';

import { useState } from 'react';

import { StaleRegion } from '@/components/shared/stale-region';
import { Card, CardContent } from '@/components/ui/card';
import { InlinePending } from '@/components/ui/inline-pending';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import {
  withdrawVacationRequest,
  type OwnVacationOverview,
  type VacationRequestListItem,
} from '@/lib/vacation/actions';
import { readInBackground } from '@/lib/data/background-read-client';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { OwnVacationBalanceSummary } from './vacation-section-balance';
import { getVacationRequestErrorMessage } from './vacation-section-messages';
import { OwnVacationRequestDialog } from './vacation-section-request-dialog';
import { OwnVacationRequestList } from './vacation-section-request-list';

// Settle key for a request that has no row yet; request ids are UUIDs.
const NEW_REQUEST_ID = 'new';

export function VacationSection() {
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  // Row-scoped pending for withdrawals and the settle window after the
  // request dialog closed; the header carries it for a brand-new request.
  const busy = useBusyIds();
  const [listError, setListError] = useState<string | null>(null);

  const view = useLiveView<OwnVacationOverview>({
    tables: ['vacation_requests', 'employment_conditions'],
    read: async ({ signal }): Promise<LiveViewResult<OwnVacationOverview>> => {
      const result = await readInBackground('own-vacation-overview', {}, signal);
      return result.success ? { ok: true, data: result.overview } : { ok: false };
    },
  });

  const overview = view.data ?? null;
  const isLoading = view.isLoading;
  // Keep last-known data on transient failure; only an initial load that
  // never produced data shows the error state.
  const loadFailed = !isLoading && overview === null;
  const refetch = view.refresh;

  const handleWithdraw = async (request: VacationRequestListItem) => {
    if (busy.isBusy(request.id)) return;
    setListError(null);
    await busy.run(request.id, async () => {
      const result = await withdrawVacationRequest({ requestId: request.id });
      if (!result.success) {
        setListError(
          getVacationRequestErrorMessage(result.error, 'Der Antrag konnte nicht zurückgezogen werden.'),
        );
      }
      await refetch();
    });
  };

  const balance = overview?.balance ?? null;
  const hasEntitlement = balance?.entitlementDays != null;

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground px-1">
        Urlaub & Abwesenheit
        <InlinePending active={busy.isBusy(NEW_REQUEST_ID)} />
      </h3>

      <StaleRegion stale={view.isStale} onRetry={view.refresh} className="space-y-3">
        {/* A failed first read is a failure with retry, never an empty card. */}
        {loadFailed ? (
          <SectionError onRetry={() => void view.refresh()} retryPending={view.isRefreshing}>
            Die Urlaubsdaten konnten nicht geladen werden.
          </SectionError>
        ) : (
          <Card>
            <CardContent className="p-4">
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-2 w-full" />
                  <Skeleton className="h-4 w-56" />
                </div>
              ) : (
                <OwnVacationBalanceSummary
                  overview={overview}
                  balance={balance}
                  setShowRequestDialog={setShowRequestDialog}
                />
              )}
            </CardContent>
          </Card>
        )}

        {overview && overview.requests.length > 0 && (
          <OwnVacationRequestList
            requests={overview.requests}
            busy={busy}
            handleWithdraw={handleWithdraw}
            listError={listError}
          />
        )}
      </StaleRegion>

      {showRequestDialog && (
        <OwnVacationRequestDialog
          hasEntitlement={hasEntitlement}
          onClose={(saved) => {
            setShowRequestDialog(false);
            if (saved) void busy.run(NEW_REQUEST_ID, refetch);
          }}
        />
      )}
    </div>
  );
}
