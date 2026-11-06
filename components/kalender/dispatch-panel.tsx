'use client';

// P1-12: the manager "Einsätze" panel. Calm, dense dispatch coordination:
// which visits are sent, confirmed, challenged, or still undispatched; which
// customer commitments no longer match the plan; explicit batch rescheduling
// with a server-computed preview. No drag gesture here ever sends a message
// or records a commitment silently.

import { StaleRegion } from '@/components/shared/stale-region';
import { useCallback } from 'react';

import { useBusyIds } from '@/hooks/use-busy-id';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import type { DispatchOverview } from '@/lib/dispatch/types';
import { DispatchPanelBatchForm, DispatchPanelBatchPreviewDetails } from './dispatch-panel-batch';
import { DispatchPanelOccurrences } from './dispatch-panel-occurrences';
import { DispatchPanelRowDialogs, useDispatchPanelRowDialogs } from './dispatch-panel-row-dialogs';
import {
  DispatchPanelChallenges,
  DispatchPanelHeader,
  DispatchPanelTravelNotes,
  DispatchPanelUnscheduledJobs,
} from './dispatch-panel-sections';
import { usePlanningWarningConfirmation } from './planning-warning-dialog';
import { CALENDAR_LAYER_CLASS } from './surface/layers';
import { useDispatchPanelBatch } from './use-dispatch-panel-batch';
import { useDispatchPanelFocus } from './use-dispatch-panel-focus';
import { useDispatchPanelOverview } from './use-dispatch-panel-overview';

type DispatchPanelOverview = ReturnType<typeof useDispatchPanelOverview>;
type RowBusy = ReturnType<typeof useBusyIds>;

/** The list's placeholder until the first overview arrives. */
function DispatchPanelLoading(): React.JSX.Element {
  return (
    <div className="space-y-2" role="status" aria-busy="true">
      <span className="sr-only">Einsätze werden geladen …</span>
      <div aria-hidden="true" className="space-y-2">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}

/** The scrolling list: its load state, then challenges, occurrences, unscheduled jobs and travel notes. */
function DispatchPanelList({
  overview,
  loadError,
  isStale,
  refresh,
  openChallenges,
  rowBusy,
  dialogs,
  batch,
}: {
  overview: DispatchOverview | null;
  loadError: DispatchPanelOverview['loadError'];
  isStale: boolean;
  refresh: DispatchPanelOverview['refresh'];
  openChallenges: DispatchPanelOverview['openChallenges'];
  rowBusy: RowBusy;
  dialogs: ReturnType<typeof useDispatchPanelRowDialogs>;
  batch: ReturnType<typeof useDispatchPanelBatch>;
}): React.JSX.Element {
  return (
    <div className="flex-1 space-y-5 overflow-y-auto p-4">
      {loadError && <SectionError onRetry={() => void refresh()}>{loadError}</SectionError>}
      {!overview && !loadError && <DispatchPanelLoading />}

      <StaleRegion stale={isStale} onRetry={refresh} className="space-y-5">
        {openChallenges.length > 0 && (
          <DispatchPanelChallenges
            openChallenges={openChallenges}
            rowBusy={rowBusy}
            setResolveChallengeId={dialogs.setResolveChallengeId}
          />
        )}

        <DispatchPanelOccurrences overview={overview} rowBusy={rowBusy} dialogs={dialogs} batch={batch} />

        {overview && overview.unscheduledJobs.length > 0 && (
          <DispatchPanelUnscheduledJobs
            overview={overview}
            rowBusy={rowBusy}
            setCancelDispatch={dialogs.setCancelDispatch}
          />
        )}

        {overview && overview.travelNotes.length > 0 && <DispatchPanelTravelNotes overview={overview} />}
      </StaleRegion>
    </div>
  );
}

/**
 * Success path of a row action: the banner fires after persistence (the dialog
 * only reports success once the server confirmed), then the row shows its
 * settle indicator until the re-read lands. `refresh` never rejects: a failed
 * read surfaces through the StaleRegion notice.
 */
function useDispatchRowSettling(
  refresh: DispatchPanelOverview['refresh'],
  onChanged: (() => void) | undefined,
  rowBusy: RowBusy,
  showBanner: ReturnType<typeof useBanner>['showBanner'],
) {
  const afterMutation = useCallback(async () => {
    await refresh();
    onChanged?.();
  }, [refresh, onChanged]);
  const settleRow = useCallback(
    (rowKey: string, message: string) => {
      showBanner({ variant: 'success', message });
      void rowBusy.run(rowKey, afterMutation);
    },
    [afterMutation, rowBusy, showBanner],
  );
  return { afterMutation, settleRow };
}

export function DispatchPanel({
  onClose,
  onChanged,
  primaryHeaderHeight = 76,
}: {
  onClose: () => void;
  onChanged?: () => void;
  primaryHeaderHeight?: number;
}) {
  const { showBanner } = useBanner();
  // Row-scoped settle indicator: after a dialog action succeeds, the row it
  // belongs to shows InlinePending until the authoritative re-read lands.
  // Row keys are the occurrence id, the unscheduled job id, or the
  // acknowledgement id of a challenge row.
  const rowBusy = useBusyIds();
  const dialogs = useDispatchPanelRowDialogs();
  const { requestApproval, warningDialog } = usePlanningWarningConfirmation();
  const { today, overview, loadError, isStale, refresh, openChallenges } = useDispatchPanelOverview();
  const panelRef = useDispatchPanelFocus(onClose);
  const { afterMutation, settleRow } = useDispatchRowSettling(refresh, onChanged, rowBusy, showBanner);
  const batch = useDispatchPanelBatch({ overview, today, requestApproval, afterMutation, showBanner });
  const { batchMode, batchPreview, setBatchPreview, isBatchWorking, batchError, runBatchCommit } = batch;

  return (
    <div
      ref={panelRef}
      data-dispatch-panel=""
      role="complementary"
      aria-label="Einsätze"
      tabIndex={-1}
      // `pb-20` keeps the list end and the batch form's submit clear of the clock button.
      className={`fixed right-0 top-0 bottom-0 ${CALENDAR_LAYER_CLASS.panel} flex w-full max-w-md flex-col border-l bg-background pb-20 shadow-xl outline-none animate-in slide-in-from-right duration-200`}
    >
      <DispatchPanelHeader
        overview={overview}
        batchMode={batchMode}
        onToggleBatchMode={batch.toggleBatchMode}
        onClose={onClose}
        primaryHeaderHeight={primaryHeaderHeight}
      />

      <DispatchPanelList
        overview={overview}
        loadError={loadError}
        isStale={isStale}
        refresh={refresh}
        openChallenges={openChallenges}
        rowBusy={rowBusy}
        dialogs={dialogs}
        batch={batch}
      />

      {batchMode && <DispatchPanelBatchForm batch={batch} />}

      {batchPreview && (
        <Dialog open onOpenChange={(open) => !open && setBatchPreview(null)} pending={isBatchWorking}>
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>Verschiebung prüfen</DialogTitle>
              <DialogDescription>
                {batchPreview.itemCount} Besuch
                {batchPreview.itemCount === 1 ? '' : 'e'} werden gemeinsam verschoben. Die Änderung erfolgt
                vollständig oder gar nicht.
              </DialogDescription>
            </DialogHeader>
            <DispatchPanelBatchPreviewDetails batchPreview={batchPreview} />
            <ErrorText>{batchError}</ErrorText>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBatchPreview(null)} disabled={isBatchWorking}>
                Abbrechen
              </Button>
              <Button
                pending={isBatchWorking}
                disabled={isBatchWorking}
                onClick={() => void runBatchCommit()}
              >
                Jetzt verschieben
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <DispatchPanelRowDialogs dialogs={dialogs} settleRow={settleRow} />

      {warningDialog}
    </div>
  );
}
