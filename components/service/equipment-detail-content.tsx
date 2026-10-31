'use client';

import { useState, type ReactElement } from 'react';

import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { Button } from '@/components/ui/button';
import { StaleRegion } from '@/components/shared/stale-region';
import { ErrorText } from '@/components/ui/error-text';
import { DetailColumns } from '@/components/shared/detail-columns';
import { RegionLoadError } from '@/components/shared/region-load-error';
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { transitionInstalledEquipment } from '@/lib/installed-equipment/actions';
import {
  EQUIPMENT_STATE_LABELS,
  getAllowedEquipmentTransitions,
  type EquipmentDetail,
  type EquipmentState,
} from '@/lib/installed-equipment/types';
import type { OrganizationDocument } from '@/lib/documents/types';
import {
  EquipmentDataSection,
  EquipmentDetailHeader,
  EquipmentHistorySection,
} from './equipment-detail-sections';
import { EquipmentDetailSidebar } from './equipment-detail-sidebar';
import { EquipmentFormDialog } from './equipment-form-dialog';
import { EquipmentArchiveDialog, EquipmentCorrectionDialog } from './equipment-reason-confirm-dialogs';
import { EquipmentSourceDialog } from './equipment-source-dialog';
import { EquipmentWorkLinkDialog } from './equipment-work-link-dialog';
import { useEquipmentDetailActions, type EquipmentDetailActions } from './use-equipment-detail-actions';

type EquipmentStateFormProps = {
  actions: EquipmentDetailActions;
  transitionStates: EquipmentState[];
  targetState: EquipmentState;
  setTargetState: (state: EquipmentState) => void;
  setStatusOpen: (open: boolean) => void;
};

/** Records the chosen state change with its reason, unless one is running or the reason is missing. */
function submitEquipmentState(
  actions: EquipmentDetailActions,
  targetState: EquipmentState,
  setStatusOpen: (open: boolean) => void,
): void {
  const { busy, item, reason, reasonError, perform, rejectInvalid } = actions;
  if (busy.isBusy('state')) return;
  if (rejectInvalid('state', { 'equipment-state-reason': reasonError })) return;
  perform(
    'state',
    () =>
      transitionInstalledEquipment({
        equipmentId: item.id,
        expectedVersion: item.version,
        toState: targetState,
        effectiveAt: new Date().toISOString(),
        reason,
        idempotencyKey: crypto.randomUUID(),
      }),
    () => setStatusOpen(false),
  );
}

// Stays in this file: the state Select is registered here as a bounded runtime
// choice (lib/ui/select-registry.test.ts).
function EquipmentStateForm({
  actions,
  transitionStates,
  targetState,
  setTargetState,
  setStatusOpen,
}: EquipmentStateFormProps): ReactElement {
  const { busy, reason, setReason, reasonError, attempted, errorFor } = actions;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Zustand ändern</DialogTitle>
        <DialogDescription>
          Die Änderung wird mit Zeitpunkt, Person und Begründung in der Historie festgehalten.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          submitEquipmentState(actions, targetState, setStatusOpen);
        }}
        noValidate
        className="flex min-h-0 flex-1 flex-col gap-4"
      >
        <DialogBody>
          <div className="space-y-4">
            <Field label="Neuer Zustand" htmlFor="equipment-target-state">
              <Select value={targetState} onValueChange={(value: EquipmentState) => setTargetState(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {transitionStates.map((state) => (
                    <SelectItem key={state} value={state}>
                      {EQUIPMENT_STATE_LABELS[state]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Begründung"
              htmlFor="equipment-state-reason"
              required
              error={attempted === 'state' ? reasonError : undefined}
            >
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
          </div>
          <ErrorText>{errorFor('state')}</ErrorText>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setStatusOpen(false)}
            disabled={busy.isBusy('state')}
          >
            Abbrechen
          </Button>
          <Button pending={busy.isBusy('state')} type="submit" disabled={busy.isBusy('state')}>
            Änderung speichern
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/** Which of the detail page's dialogs is open. */
function useEquipmentDialogs() {
  const [editOpen, setEditOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [workLinkOpen, setWorkLinkOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  return {
    editOpen,
    setEditOpen,
    replaceOpen,
    setReplaceOpen,
    statusOpen,
    setStatusOpen,
    correctionOpen,
    setCorrectionOpen,
    archiveOpen,
    setArchiveOpen,
    workLinkOpen,
    setWorkLinkOpen,
    sourceOpen,
    setSourceOpen,
  };
}

type EquipmentDialogs = ReturnType<typeof useEquipmentDialogs>;

type EquipmentDetailRegionProps = {
  actions: EquipmentDetailActions;
  dialogs: EquipmentDialogs;
  documents: OrganizationDocument[];
  documentsLoadFailed: boolean;
  terminalEvent: EquipmentDetail['events'][number] | undefined;
  transitionStates: EquipmentState[];
  onChangeState: () => void;
};

/** The record's header, data, documents, history and sidebar, behind the live view's stale state. */
function EquipmentDetailRegion({
  actions,
  dialogs,
  documents,
  documentsLoadFailed,
  terminalEvent,
  transitionStates,
  onChangeState,
}: EquipmentDetailRegionProps): ReactElement {
  const { busy, live, item, clearReason } = actions;
  const headerBusy = busy.isBusy('state') || busy.isBusy('correction') || busy.isBusy('archive');
  return (
    <StaleRegion stale={live.isStale} onRetry={live.refresh} className="space-y-6">
      <EquipmentDetailHeader
        item={item}
        headerBusy={headerBusy}
        canChangeState={!(item.archivedAt || item.voidedAt || transitionStates.length === 0)}
        onEdit={() => dialogs.setEditOpen(true)}
        onReplace={() => dialogs.setReplaceOpen(true)}
        onChangeState={onChangeState}
      />

      {item.voidedAt && (
        <p role="status" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          Dieser Nachfolger wurde durch eine Korrektur als irrtümlich erfasst markiert. Seine Historie bleibt
          erhalten.
        </p>
      )}
      <ErrorText>{actions.pageError}</ErrorText>

      <DetailColumns layout="main-and-wide-aside">
        <div className="min-w-0 space-y-6">
          <EquipmentDataSection item={item} detailsBusy={busy.isBusy('details')} />

          {documentsLoadFailed ? (
            <RegionLoadError>Dokumente und Bilder konnten nicht geladen werden.</RegionLoadError>
          ) : (
            <ContextualDocumentsSection
              title="Dokumente & Bilder"
              description="Dokumente werden aus der zentralen Dokumentenablage verknüpft. Es entsteht keine Dateikopie."
              documents={documents}
              documentTarget={{ kind: 'equipment', equipmentId: item.id }}
              contextLabel={item.name}
              canUpload
              canManage
              keepUploadedDocumentsVisible
            />
          )}

          <EquipmentHistorySection events={item.events} sourceBusy={busy.isBusy('source')} />
        </div>

        <EquipmentDetailSidebar
          actions={actions}
          canCorrectTerminalAction={Boolean(terminalEvent && !item.archivedAt)}
          onOpenWorkLink={() => {
            actions.setAttempted(null);
            dialogs.setWorkLinkOpen(true);
          }}
          onOpenSource={() => {
            actions.setError(null);
            actions.setAttempted(null);
            clearReason();
            dialogs.setSourceOpen(true);
          }}
          onOpenCorrection={() => {
            clearReason();
            dialogs.setCorrectionOpen(true);
          }}
          onOpenArchive={() => {
            clearReason();
            dialogs.setArchiveOpen(true);
          }}
        />
      </DetailColumns>
    </StaleRegion>
  );
}

type EquipmentDetailContentProps = {
  initial: EquipmentDetail;
  documents: OrganizationDocument[];
  documentsLoadFailed: boolean;
};

export function EquipmentDetailContent({
  initial,
  documents,
  documentsLoadFailed,
}: EquipmentDetailContentProps): ReactElement {
  const actions = useEquipmentDetailActions(initial);
  const { busy, live, item, clearReason } = actions;
  const dialogs = useEquipmentDialogs();
  const { editOpen, setEditOpen, replaceOpen, setReplaceOpen, statusOpen, setStatusOpen } = dialogs;
  const { correctionOpen, setCorrectionOpen, archiveOpen, setArchiveOpen } = dialogs;
  const { workLinkOpen, setWorkLinkOpen, sourceOpen, setSourceOpen } = dialogs;
  const [targetState, setTargetState] = useState<EquipmentState>('inactive');
  const terminalEvent = item.events.find(
    (event) => event.eventType === 'replaced' || event.eventType === 'decommissioned',
  );
  const transitionStates = getAllowedEquipmentTransitions(item.state);

  function openStatusDialog(): void {
    const [firstTransition] = transitionStates;
    if (!firstTransition) return;
    clearReason();
    setTargetState(firstTransition);
    setStatusOpen(true);
  }

  return (
    <>
      <EquipmentDetailRegion
        actions={actions}
        dialogs={dialogs}
        documents={documents}
        documentsLoadFailed={documentsLoadFailed}
        terminalEvent={terminalEvent}
        transitionStates={transitionStates}
        onChangeState={openStatusDialog}
      />

      {editOpen && (
        <EquipmentFormDialog
          open
          onOpenChange={setEditOpen}
          mode="edit"
          initial={item}
          onSaved={() => void busy.run('details', live.refresh)}
        />
      )}
      {replaceOpen && (
        <EquipmentFormDialog open onOpenChange={setReplaceOpen} mode="replace" initial={item} />
      )}

      <Dialog open={statusOpen} onOpenChange={setStatusOpen} pending={busy.isBusy('state')}>
        <DialogContent>
          <EquipmentStateForm
            actions={actions}
            transitionStates={transitionStates}
            targetState={targetState}
            setTargetState={setTargetState}
            setStatusOpen={setStatusOpen}
          />
        </DialogContent>
      </Dialog>

      <EquipmentWorkLinkDialog open={workLinkOpen} onOpenChange={setWorkLinkOpen} actions={actions} />

      {sourceOpen && <EquipmentSourceDialog open onOpenChange={setSourceOpen} actions={actions} />}

      <EquipmentCorrectionDialog
        open={correctionOpen}
        onOpenChange={setCorrectionOpen}
        actions={actions}
        terminalEvent={terminalEvent}
      />

      <EquipmentArchiveDialog open={archiveOpen} onOpenChange={setArchiveOpen} actions={actions} />
    </>
  );
}
