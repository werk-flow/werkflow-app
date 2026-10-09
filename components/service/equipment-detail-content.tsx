'use client';

import { useState, type ReactElement } from 'react';

import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { Button } from '@/components/ui/button';
import { StaleRegion } from '@/components/shared/stale-region';
import { ErrorText } from '@/components/ui/error-text';
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

// Stays in this file: the state Select is registered here as a bounded runtime
// choice (lib/ui/select-registry.test.ts).
function EquipmentStateForm({
  actions,
  transitionStates,
  targetState,
  setTargetState,
  setStatusOpen,
}: EquipmentStateFormProps): ReactElement {
  const { busy, item, reason, setReason, reasonError, attempted, errorFor } = actions;
  const { perform, rejectInvalid } = actions;
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
  const [editOpen, setEditOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [workLinkOpen, setWorkLinkOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [targetState, setTargetState] = useState<EquipmentState>('inactive');
  const terminalEvent = item.events.find(
    (event) => event.eventType === 'replaced' || event.eventType === 'decommissioned',
  );
  const transitionStates = getAllowedEquipmentTransitions(item.state);
  const headerBusy = busy.isBusy('state') || busy.isBusy('correction') || busy.isBusy('archive');

  function openStatusDialog(): void {
    const [firstTransition] = transitionStates;
    if (!firstTransition) return;
    clearReason();
    setTargetState(firstTransition);
    setStatusOpen(true);
  }

  return (
    <>
      <StaleRegion stale={live.isStale} onRetry={live.refresh} className="space-y-6">
        <EquipmentDetailHeader
          item={item}
          headerBusy={headerBusy}
          canChangeState={!(item.archivedAt || item.voidedAt || transitionStates.length === 0)}
          onEdit={() => setEditOpen(true)}
          onReplace={() => setReplaceOpen(true)}
          onChangeState={openStatusDialog}
        />

        {item.voidedAt && (
          <p role="status" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
            Dieser Nachfolger wurde durch eine Korrektur als irrtümlich erfasst markiert. Seine Historie
            bleibt erhalten.
          </p>
        )}
        <ErrorText>{actions.pageError}</ErrorText>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <div className="space-y-6">
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
              setWorkLinkOpen(true);
            }}
            onOpenSource={() => {
              actions.setError(null);
              actions.setAttempted(null);
              clearReason();
              setSourceOpen(true);
            }}
            onOpenCorrection={() => {
              clearReason();
              setCorrectionOpen(true);
            }}
            onOpenArchive={() => {
              clearReason();
              setArchiveOpen(true);
            }}
          />
        </div>
      </StaleRegion>

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
