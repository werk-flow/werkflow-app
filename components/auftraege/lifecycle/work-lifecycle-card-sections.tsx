'use client';

import { StaleRegion } from '@/components/shared/stale-region';
import type { ReactElement } from 'react';
import { LockKeyhole } from 'lucide-react';

import type { LiveViewState } from '@/hooks/use-live-view';
import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import {
  getAllowedWorkTransitions,
  type WorkBlocker,
  type WorkExecutionState,
  type WorkLifecycleSnapshot,
} from '@/lib/work-lifecycle/types';
import {
  WorkLifecycleBlockersSection,
  WorkLifecycleResolvedBlockers,
} from './work-lifecycle-blockers-section';
import { WorkLifecycleDependenciesSection } from './work-lifecycle-dependencies-section';
import type { WorkLifecycleDialogState } from './work-lifecycle-dialog-state';
import { WorkLifecycleGatesAndHistory } from './work-lifecycle-gates-history';
import { WorkLifecycleReadinessSection } from './work-lifecycle-status';
import { WorkLifecycleTransitionActions } from './work-lifecycle-transition-actions';

type WorkLifecycleView = Pick<LiveViewState<WorkLifecycleSnapshot>, 'isStale' | 'isRefreshing'>;

/** The hint that the snapshot changed while a dialog was open, with an immediate refresh. */
export function WorkLifecycleRemoteUpdateHint({
  view,
  onRefresh,
}: {
  view: WorkLifecycleView;
  onRefresh: () => void;
}): ReactElement {
  return (
    <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <span>Während der Eingabe hat sich der Arbeitsstand geändert.</span>
      <Button type="button" size="sm" variant="outline" disabled={view.isRefreshing} onClick={onRefresh}>
        <InlinePending active={view.isRefreshing} label="Wird aktualisiert" />
        Aktualisieren
      </Button>
    </div>
  );
}

type WorkLifecycleCardSectionsProps = {
  snapshot: WorkLifecycleSnapshot;
  view: WorkLifecycleView;
  refresh: LiveViewState<WorkLifecycleSnapshot>['refresh'];
  isManager: boolean;
  fieldMode: boolean;
  hasPendingDispatch: boolean;
  readOnly: boolean;
  canStart: boolean;
  parking: WorkBlocker | undefined;
  unmetDependencies: number;
  pendingState: WorkExecutionState | null;
  ownerNames: Map<string, string>;
  ownOwnerId: string | null;
  rowBusy: { isBusy: (id: string) => boolean };
  setDialog: (dialog: WorkLifecycleDialogState | null) => void;
};

/** The card's actions, readiness, open items and history, marked stale while the snapshot is behind. */
export function WorkLifecycleCardSections({
  snapshot,
  view,
  refresh,
  isManager,
  fieldMode,
  hasPendingDispatch,
  readOnly,
  canStart,
  parking,
  unmetDependencies,
  pendingState,
  ownerNames,
  ownOwnerId,
  rowBusy,
  setDialog,
}: WorkLifecycleCardSectionsProps): ReactElement {
  return (
    <StaleRegion stale={view.isStale} onRetry={refresh} className="flex flex-col gap-4">
      <WorkLifecycleTransitionActions
        snapshot={snapshot}
        transitions={getAllowedWorkTransitions(snapshot.executionState, isManager)}
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
    </StaleRegion>
  );
}
