'use client';

import type { LiveViewState } from '@/hooks/use-live-view';
import {
  clearProjectWorkExecutionOverride,
  removeWorkDependency,
  reopenWorkBlocker,
  setDeclaredWorkDependencyState,
  setWorkBlockerResolved,
  unparkWorkTarget,
} from '@/lib/work-lifecycle/actions';
import type { WorkExecutionState, WorkLifecycleSnapshot } from '@/lib/work-lifecycle/types';
import { ArtifactApprovalDependencyDialog } from './work-lifecycle-artifact-approval-dialog';
import { WorkBlockerDialog } from './work-lifecycle-blocker-dialog';
import { WorkDependencyDialog } from './work-lifecycle-dependency-dialog';
import type { WorkLifecycleDialogState, WorkTransitionInput } from './work-lifecycle-dialog-state';
import { ReasonDialog } from './work-lifecycle-reason-dialog';
import { WorkTransitionDialog } from './work-lifecycle-transition-dialog';

type WorkLifecycleCardDialogsProps = {
  dialog: WorkLifecycleDialogState | null;
  setDialog: (dialog: WorkLifecycleDialogState | null) => void;
  /** The confirmed snapshot with the optimistic execution state applied. */
  snapshot: WorkLifecycleSnapshot;
  confirmedSnapshot: WorkLifecycleSnapshot;
  targetLabel: string;
  isManager: boolean;
  changed: (message?: string, nextExecutionState?: WorkExecutionState) => Promise<void>;
  changedRow: (rowId: string, message: string) => Promise<void>;
  setSnapshot: LiveViewState<WorkLifecycleSnapshot>['setData'];
  transition: (input: WorkTransitionInput) => Promise<string | null>;
};

function WorkLifecycleBlockerReasonDialogs({
  dialog,
  setDialog,
  snapshot,
  changedRow,
}: Pick<WorkLifecycleCardDialogsProps, 'dialog' | 'setDialog' | 'snapshot' | 'changedRow'>) {
  return (
    <>
      {dialog?.type === 'resolve-blocker' && (
        <ReasonDialog
          title="Blocker lösen"
          description="Die Lösung bleibt mit Version und Begründung im Verlauf erhalten."
          submitLabel="Lösen"
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            const result = await setWorkBlockerResolved({
              blockerId: dialog.blocker.id,
              expectedVersion: dialog.blocker.version,
              resolutionNote: reason,
            });
            if (result.success) await changedRow(dialog.blocker.id, 'Blocker wurde gelöst.');
            return result;
          }}
        />
      )}
      {dialog?.type === 'unpark' && (
        <ReasonDialog
          title="Parkplatz verlassen"
          description="Das Planen eines neuen Termins bleibt ein eigener Schritt."
          submitLabel="Weiterführen"
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            const result = await unparkWorkTarget({
              targetType: snapshot.targetType,
              targetId: snapshot.targetId,
              blockerVersion: dialog.blocker.version,
              reason,
            });
            if (result.success) await changedRow(dialog.blocker.id, 'Arbeit ist nicht mehr geparkt.');
            return result;
          }}
        />
      )}
      {dialog?.type === 'reopen-blocker' && (
        <ReasonDialog
          title="Blocker wieder öffnen"
          description="Der Blocker wird erneut aktiv; der bisherige Verlauf bleibt erhalten."
          submitLabel="Wieder öffnen"
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            const result = await reopenWorkBlocker({
              blockerId: dialog.blocker.id,
              expectedVersion: dialog.blocker.version,
              reason,
            });
            if (result.success) await changedRow(dialog.blocker.id, 'Blocker wurde wieder geöffnet.');
            return result;
          }}
        />
      )}
    </>
  );
}

function WorkLifecycleDependencyReasonDialogs({
  dialog,
  setDialog,
  changedRow,
  setSnapshot,
}: Pick<WorkLifecycleCardDialogsProps, 'dialog' | 'setDialog' | 'changedRow' | 'setSnapshot'>) {
  return (
    <>
      {dialog?.type === 'dependency-state' && (
        <ReasonDialog
          title={
            dialog.state === 'open' ? 'Voraussetzung wieder öffnen' : 'Voraussetzung als erfüllt markieren'
          }
          description="Die Änderung gilt nur für diese deklarierte Voraussetzung und wird protokolliert."
          submitLabel="Speichern"
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            const result = await setDeclaredWorkDependencyState({
              dependencyId: dialog.dependency.id,
              expectedVersion: dialog.dependency.version,
              state: dialog.state,
              reason,
            });
            if (result.success) {
              setSnapshot(
                (current) =>
                  current && {
                    ...current,
                    dependencies: current.dependencies.map((dependency) =>
                      dependency.id === dialog.dependency.id
                        ? {
                            ...dependency,
                            manual_state: dialog.state,
                            version: result.dependency.version,
                            is_satisfied: dialog.state !== 'open',
                          }
                        : dependency,
                    ),
                  },
              );
              await changedRow(dialog.dependency.id, 'Voraussetzung wurde aktualisiert.');
            }
            return result;
          }}
        />
      )}
      {dialog?.type === 'remove-dependency' && (
        <ReasonDialog
          title="Voraussetzung entfernen"
          description="Die Verknüpfung wird beendet; ihr Verlauf bleibt erhalten."
          submitLabel="Entfernen"
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            const result = await removeWorkDependency({
              dependencyId: dialog.dependency.id,
              expectedVersion: dialog.dependency.version,
              reason,
            });
            if (result.success) {
              setSnapshot(
                (current) =>
                  current && {
                    ...current,
                    dependencies: current.dependencies.filter(
                      (dependency) => dependency.id !== dialog.dependency.id,
                    ),
                  },
              );
              await changedRow(dialog.dependency.id, 'Voraussetzung wurde entfernt.');
            }
            return result;
          }}
        />
      )}
    </>
  );
}

/** Renders whichever dialog the card currently has open. */
export function WorkLifecycleCardDialogs({
  dialog,
  setDialog,
  snapshot,
  confirmedSnapshot,
  targetLabel,
  isManager,
  changed,
  changedRow,
  setSnapshot,
  transition,
}: WorkLifecycleCardDialogsProps) {
  return (
    <>
      {dialog?.type === 'transition' && (
        <WorkTransitionDialog
          snapshot={confirmedSnapshot}
          targetLabel={targetLabel}
          transition={dialog.state}
          isManager={isManager}
          onClose={() => setDialog(null)}
          onTransition={transition}
        />
      )}
      {dialog?.type === 'blocker' && (
        <WorkBlockerDialog
          snapshot={snapshot}
          kind="blocker"
          blocker={dialog.blocker}
          isManager={isManager}
          onClose={() => setDialog(null)}
          onChanged={() =>
            dialog.blocker
              ? changedRow(dialog.blocker.id, 'Blocker wurde gespeichert.')
              : changed('Blocker wurde gespeichert.')
          }
        />
      )}
      {dialog?.type === 'parking' && (
        <WorkBlockerDialog
          snapshot={snapshot}
          kind="parking"
          isManager={isManager}
          onClose={() => setDialog(null)}
          onChanged={() => changed('Arbeit wurde geparkt.')}
        />
      )}
      {dialog?.type === 'dependency' && (
        <WorkDependencyDialog
          snapshot={snapshot}
          onClose={() => setDialog(null)}
          onChanged={() => changed('Voraussetzung wurde hinzugefügt.')}
        />
      )}
      {dialog?.type === 'artifact-approval-dependency' && (
        <ArtifactApprovalDependencyDialog
          snapshot={snapshot}
          dependency={dialog.dependency}
          onClose={() => setDialog(null)}
          onChanged={() =>
            changedRow(dialog.dependency.id, 'Freigabe wurde mit der Voraussetzung verknüpft.')
          }
        />
      )}
      <WorkLifecycleBlockerReasonDialogs
        dialog={dialog}
        setDialog={setDialog}
        snapshot={snapshot}
        changedRow={changedRow}
      />
      <WorkLifecycleDependencyReasonDialogs
        dialog={dialog}
        setDialog={setDialog}
        changedRow={changedRow}
        setSnapshot={setSnapshot}
      />
      {dialog?.type === 'clear-project-override' && (
        <ReasonDialog
          title="Projektstand automatisch ableiten"
          description="Der Projektstand folgt danach wieder den zugehörigen Aufträgen. Die Änderung bleibt im Verlauf erhalten."
          submitLabel="Automatisch ableiten"
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            const result = await clearProjectWorkExecutionOverride({
              projectId: snapshot.targetId,
              expectedVersion: snapshot.executionVersion,
              reason,
            });
            if (result.success) await changed('Der Projektstand wird wieder automatisch abgeleitet.');
            return result;
          }}
        />
      )}
    </>
  );
}
