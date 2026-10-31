'use client';

import { useMemo, useState, type ReactElement } from 'react';

import { useLiveView } from '@/hooks/use-live-view';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useBanner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
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
import { WorkLifecycleCardDialogs } from './work-lifecycle-card-dialogs';
import { WorkLifecycleCardSections, WorkLifecycleRemoteUpdateHint } from './work-lifecycle-card-sections';
import type { WorkLifecycleDialogState, WorkTransitionInput } from './work-lifecycle-dialog-state';
import { workLifecycleErrorMessage } from './work-lifecycle-messages';
import { WorkLifecycleStatusHeader } from './work-lifecycle-status';

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

/**
 * The card's live snapshot. An open dialog suspends the reads; a change that
 * arrives under it records that dialog for the in-card hint.
 */
function useWorkLifecycleLiveView({
  initialSnapshot,
  dialog,
  setRemoteUpdateDialog,
}: {
  initialSnapshot: WorkLifecycleSnapshot;
  dialog: WorkLifecycleDialogState | null;
  setRemoteUpdateDialog: (dialog: WorkLifecycleDialogState | null) => void;
}) {
  return useLiveView<WorkLifecycleSnapshot>({
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
}

/** The live snapshot, the open dialog, the optimistic execution state and the writes that follow them. */
function useWorkLifecycleCardState({
  initialSnapshot,
  fieldMode,
}: Pick<WorkLifecycleCardProps, 'initialSnapshot'> & { fieldMode: boolean }) {
  const [dialog, setDialog] = useState<WorkLifecycleDialogState | null>(null);
  // Holds the dialog the remote change arrived under: identity comparison
  // hides the hint automatically once that dialog closes (the queued
  // catch-up read runs then anyway), with no state cleanup effect.
  const [remoteUpdateDialog, setRemoteUpdateDialog] = useState<WorkLifecycleDialogState | null>(null);
  const { showBanner } = useBanner();
  const rowBusy = useBusyIds();
  const view = useWorkLifecycleLiveView({ initialSnapshot, dialog, setRemoteUpdateDialog });
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
    // card's snapshot: every write here revalidates (revalidateWork), so its
    // response renders the route. The card reads its own snapshot.
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

/** The counts and readiness the card header and its actions read from one snapshot. */
function workLifecycleCardSummary(snapshot: WorkLifecycleSnapshot) {
  const parking = snapshot.blockers.find((blocker) => blocker.kind === 'parking');
  const blockingCount = snapshot.blockers.filter((blocker) => blocker.kind === 'blocker').length;
  const unmetDependencies = snapshot.dependencies.filter(
    (dependency) => !dependency.is_satisfied && dependency.effect !== 'warning',
  ).length;
  const canStart = !parking && blockingCount === 0 && snapshot.gates.openStartDependencies === 0;
  const startReadinessKnown = canStart && !snapshot.readinessLoadFailed;
  const nextAction = getWorkNextAction(snapshot);
  return { parking, blockingCount, unmetDependencies, canStart, startReadinessKnown, nextAction };
}

export function WorkLifecycleCard({
  initialSnapshot,
  targetLabel,
  isManager,
  fieldMode = false,
  hasPendingDispatch = false,
  readOnly = false,
}: WorkLifecycleCardProps): ReactElement {
  const state = useWorkLifecycleCardState({ initialSnapshot, fieldMode });
  const { dialog, setDialog, setRemoteUpdateDialog, rowBusy, view, pendingState, snapshot, refresh } = state;
  const { parking, blockingCount, unmetDependencies, canStart, startReadinessKnown, nextAction } =
    workLifecycleCardSummary(snapshot);
  const ownerNames = useMemo(
    () => new Map(snapshot.ownerOptions.map((owner) => [owner.value, owner.label])),
    [snapshot.ownerOptions],
  );
  const ownOwnerId = isManager ? null : snapshot.ownOwnerId;

  return (
    <Card
      id="arbeitsstand"
      className="gap-4 p-4"
      data-testid="work-lifecycle-card"
      unconfirmed={pendingState !== null}
    >
      <WorkLifecycleStatusHeader
        snapshot={snapshot}
        pendingState={pendingState}
        nextAction={nextAction}
        canStart={canStart}
        startReadinessKnown={startReadinessKnown}
        parking={parking}
        blockingCount={blockingCount}
      />
      {state.showRemoteUpdateHint && (
        <WorkLifecycleRemoteUpdateHint
          view={view}
          onRefresh={() => {
            setRemoteUpdateDialog(null);
            void refresh();
          }}
        />
      )}
      <WorkLifecycleCardSections
        snapshot={snapshot}
        view={view}
        refresh={refresh}
        isManager={isManager}
        fieldMode={fieldMode}
        hasPendingDispatch={hasPendingDispatch}
        readOnly={readOnly}
        canStart={canStart}
        parking={parking}
        unmetDependencies={unmetDependencies}
        pendingState={pendingState}
        ownerNames={ownerNames}
        ownOwnerId={ownOwnerId}
        rowBusy={rowBusy}
        setDialog={setDialog}
      />
      <WorkLifecycleCardDialogs
        dialog={dialog}
        setDialog={setDialog}
        snapshot={snapshot}
        confirmedSnapshot={state.confirmedSnapshot}
        targetLabel={targetLabel}
        isManager={isManager}
        changed={state.changed}
        changedRow={state.changedRow}
        setSnapshot={state.setSnapshot}
        transition={state.transition}
      />
    </Card>
  );
}
