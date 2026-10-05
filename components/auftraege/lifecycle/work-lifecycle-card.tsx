'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole } from 'lucide-react';

import { useLiveView } from '@/hooks/use-live-view';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlinePending } from '@/components/ui/inline-pending';
import { SectionError } from '@/components/ui/section-error';
import { useRouterRefresh } from '@/components/ui/refresh-button';
import { isFieldWorkPackReadOnly } from '@/lib/jobs/field-work-pack';
import { loadDocument } from '@/lib/navigation/document-load';
import { readInBackground } from '@/lib/data/background-read-client';
import { transitionWorkExecution } from '@/lib/work-lifecycle/actions';
import {
  getWorkNextAction,
  type WorkExecutionState,
  type WorkLifecycleSnapshot,
} from '@/lib/work-lifecycle/types';
import {
  WorkLifecycleBlockersSection,
  WorkLifecycleResolvedBlockers,
} from './work-lifecycle-blockers-section';
import { WorkLifecycleCardDialogs } from './work-lifecycle-card-dialogs';
import { WorkLifecycleDependenciesSection } from './work-lifecycle-dependencies-section';
import type { WorkLifecycleDialogState, WorkTransitionInput } from './work-lifecycle-dialog-state';
import { WorkLifecycleGatesAndHistory } from './work-lifecycle-gates-history';
import { workLifecycleErrorMessage } from './work-lifecycle-messages';
import { WorkLifecycleReadinessSection, WorkLifecycleStatusHeader } from './work-lifecycle-status';
import { WorkLifecycleTransitionActions } from './work-lifecycle-transition-actions';

type WorkLifecycleCardProps = {
  initialSnapshot: WorkLifecycleSnapshot;
  targetLabel: string;
  isManager: boolean;
  fieldMode?: boolean;
  hasPendingDispatch?: boolean;
  readOnly?: boolean;
};

export function WorkLifecycleLoadError(): ReactElement {
  const { refresh, isPending } = useRouterRefresh();
  return (
    <SectionError title="Arbeitsstand nicht verfügbar" onRetry={refresh} retryPending={isPending}>
      Auftrag oder Projekt bleiben sichtbar. Der Arbeitsstand konnte gerade nicht geladen werden und wird
      nicht als erfüllt angenommen.
    </SectionError>
  );
}

/** The live snapshot, the open dialog, the optimistic execution state and the writes that follow them. */
function useWorkLifecycleCardState({
  initialSnapshot,
  fieldMode,
}: Pick<WorkLifecycleCardProps, 'initialSnapshot'> & { fieldMode: boolean }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<WorkLifecycleDialogState | null>(null);
  // Holds the dialog the remote change arrived under: identity comparison
  // hides the hint automatically once that dialog closes (the queued
  // catch-up read runs then anyway), with no state cleanup effect.
  const [remoteUpdateDialog, setRemoteUpdateDialog] = useState<WorkLifecycleDialogState | null>(null);
  const { showBanner } = useBanner();
  const rowBusy = useBusyIds();
  const view = useLiveView<WorkLifecycleSnapshot>({
    tables: [
      initialSnapshot.targetType === 'job' ? 'jobs' : 'projects',
      'work_blockers',
      'work_dependencies',
      'job_instruction_items',
      'job_instruction_item_evidence_fulfillments',
      'time_entries',
      'time_sessions',
      'time_segments',
      'job_assignments',
      'planning_occurrence_assignments',
      'planning_occurrences',
      'job_capability_requirements',
      'employee_capabilities',
      'organization_capabilities',
      'job_material_lines',
      'inventory_stock_levels',
    ],
    read: async ({ signal }) => {
      const result = await readInBackground(
        'work-lifecycle-snapshot',
        {
          targetType: initialSnapshot.targetType,
          targetId: initialSnapshot.targetId,
        },
        signal,
      );
      return result.success ? { ok: true, data: result.snapshot } : { ok: false };
    },
    initialData: initialSnapshot,
    resetKey: `${initialSnapshot.targetType}:${initialSnapshot.targetId}`,
    // The card's ReasonDialog flows suspend reads; the in-card hint offers
    // an immediate refresh while typing continues.
    suspend: dialog !== null,
    eventFilter: () => {
      if (dialog !== null) setRemoteUpdateDialog(dialog);
      return true;
    },
  });
  // The state the user just chose, shown until the server confirms or refuses it.
  const [pendingState, setPendingState] = useState<WorkExecutionState | null>(null);
  const confirmedSnapshot = view.data ?? initialSnapshot;
  const snapshot = pendingState ? { ...confirmedSnapshot, executionState: pendingState } : confirmedSnapshot;
  const setSnapshot = view.setData;
  const refresh = view.refresh;
  const showRemoteUpdateHint = remoteUpdateDialog !== null && remoteUpdateDialog === dialog;

  const changed = async (message?: string, nextExecutionState?: WorkExecutionState) => {
    if (fieldMode && nextExecutionState && isFieldWorkPackReadOnly(nextExecutionState)) {
      // Full document load: a read-only state replaces the whole field work
      // pack, so the route renders anew and the flash parameter confirms it.
      const url = new URL(window.location.href);
      url.searchParams.set('field_transition', 'updated');
      loadDocument(url.toString());
      return;
    }
    // Header metadata and project summaries are owned by the route, not this
    // card's snapshot. Local success must reconcile them without Realtime.
    router.refresh();
    await refresh();
    if (message) showBanner({ variant: 'success', message });
  };
  const changedRow = async (rowId: string, message: string) => rowBusy.run(rowId, () => changed(message));
  const transition = async (input: WorkTransitionInput): Promise<string | null> => {
    view.invalidate();
    setPendingState(input.toState);
    try {
      const result = await transitionWorkExecution({
        targetType: confirmedSnapshot.targetType,
        targetId: confirmedSnapshot.targetId,
        expectedVersion: confirmedSnapshot.executionVersion,
        ...input,
      }).catch(() => null);
      if (!result?.success) {
        // The previous state returns with the reason; a version conflict also
        // loads the state another session wrote.
        if (!result || result.error.includes('stale_version')) await refresh();
        return workLifecycleErrorMessage(result?.error ?? '');
      }
      // The accepted state stays even when the read after it fails.
      setSnapshot(
        (current) =>
          current && {
            ...current,
            executionState: result.transition.execution_state,
            executionVersion: result.transition.execution_version,
          },
      );
      await changed('Arbeitsstand wurde aktualisiert.', input.toState);
      return null;
    } finally {
      setPendingState(null);
    }
  };

  return {
    dialog,
    setDialog,
    setRemoteUpdateDialog,
    rowBusy,
    view,
    pendingState,
    confirmedSnapshot,
    snapshot,
    setSnapshot,
    refresh,
    showRemoteUpdateHint,
    changed,
    changedRow,
    transition,
  };
}

export function WorkLifecycleCard({
  initialSnapshot,
  targetLabel,
  isManager,
  fieldMode = false,
  hasPendingDispatch = false,
  readOnly = false,
}: WorkLifecycleCardProps): ReactElement {
  const {
    dialog,
    setDialog,
    setRemoteUpdateDialog,
    rowBusy,
    view,
    pendingState,
    confirmedSnapshot,
    snapshot,
    setSnapshot,
    refresh,
    showRemoteUpdateHint,
    changed,
    changedRow,
    transition,
  } = useWorkLifecycleCardState({ initialSnapshot, fieldMode });
  const parking = snapshot.blockers.find((blocker) => blocker.kind === 'parking');
  const blockingCount = snapshot.blockers.filter((blocker) => blocker.kind === 'blocker').length;
  const unmetDependencies = snapshot.dependencies.filter(
    (dependency) => !dependency.is_satisfied && dependency.effect !== 'warning',
  ).length;
  const canStart = !parking && blockingCount === 0 && snapshot.gates.openStartDependencies === 0;
  const startReadinessKnown = canStart && !snapshot.readinessLoadFailed;
  const nextAction = getWorkNextAction(snapshot);
  const ownerNames = useMemo(
    () => new Map(snapshot.ownerOptions.map((owner) => [owner.value, owner.label])),
    [snapshot.ownerOptions],
  );
  const ownOwnerId = isManager ? null : snapshot.ownOwnerId;

  return (
    <Card id="arbeitsstand" className="gap-4 p-4" data-testid="work-lifecycle-card">
      <WorkLifecycleStatusHeader
        snapshot={snapshot}
        pendingState={pendingState}
        nextAction={nextAction}
        canStart={canStart}
        startReadinessKnown={startReadinessKnown}
        parking={parking}
        blockingCount={blockingCount}
      />
      {showRemoteUpdateHint && (
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span>Während der Eingabe hat sich der Arbeitsstand geändert.</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={view.isRefreshing}
            onClick={() => {
              setRemoteUpdateDialog(null);
              void refresh();
            }}
          >
            <InlinePending active={view.isRefreshing} label="Wird aktualisiert" />
            Aktualisieren
          </Button>
        </div>
      )}
      <WorkLifecycleTransitionActions
        snapshot={snapshot}
        isManager={isManager}
        fieldMode={fieldMode}
        hasPendingDispatch={hasPendingDispatch}
        readOnly={readOnly}
        canStart={canStart}
        parking={parking}
        pendingState={pendingState}
        setDialog={setDialog}
      />
      <WorkLifecycleReadinessSection
        snapshot={snapshot}
        onRetry={() => void refresh()}
        retryPending={view.isRefreshing}
      />
      <div id="offene-punkte" className="grid scroll-mt-28 gap-4 lg:grid-cols-2">
        <WorkLifecycleBlockersSection
          snapshot={snapshot}
          isManager={isManager}
          readOnly={readOnly}
          ownerNames={ownerNames}
          ownOwnerId={ownOwnerId}
          rowBusy={rowBusy}
          setDialog={setDialog}
        />
        <WorkLifecycleDependenciesSection
          snapshot={snapshot}
          isManager={isManager}
          rowBusy={rowBusy}
          setDialog={setDialog}
        />
      </div>
      {isManager && snapshot.resolvedBlockers.length > 0 && (
        <WorkLifecycleResolvedBlockers snapshot={snapshot} setDialog={setDialog} />
      )}
      <WorkLifecycleGatesAndHistory snapshot={snapshot} />
      {unmetDependencies > 0 && (
        <p className="flex items-center gap-2 text-sm text-warning-text">
          <LockKeyhole className="size-4" />
          {unmetDependencies} offene Voraussetzung(en) beeinflussen die nächste Änderung.
        </p>
      )}
      <WorkLifecycleCardDialogs
        dialog={dialog}
        setDialog={setDialog}
        snapshot={snapshot}
        confirmedSnapshot={confirmedSnapshot}
        targetLabel={targetLabel}
        isManager={isManager}
        changed={changed}
        changedRow={changedRow}
        setSnapshot={setSnapshot}
        transition={transition}
      />
    </Card>
  );
}
