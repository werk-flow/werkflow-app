'use client';

import type { ReactElement } from 'react';
import { Loader2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import {
  correctInstalledEquipmentTerminalAction,
  setInstalledEquipmentArchived,
} from '@/lib/installed-equipment/actions';
import type { EquipmentDetail } from '@/lib/installed-equipment/types';
import type { EquipmentDetailActions } from './use-equipment-detail-actions';

type EquipmentCorrectionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: EquipmentDetailActions;
  terminalEvent: EquipmentDetail['events'][number] | undefined;
};

export function EquipmentCorrectionDialog({
  open,
  onOpenChange,
  actions,
  terminalEvent,
}: EquipmentCorrectionDialogProps): ReactElement {
  const { busy, item, reason, setReason, reasonError, attempted, errorFor } = actions;
  const { perform, rejectInvalid } = actions;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange} pending={busy.isBusy('correction')}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Abschlussaktion korrigieren?</AlertDialogTitle>
          <AlertDialogDescription>
            Die ursprüngliche Aktion bleibt sichtbar. Bei einer Ersetzung wird der irrtümliche Nachfolger als
            korrigierter Datensatz erhalten.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field
          label="Korrekturgrund"
          htmlFor="equipment-correction-reason"
          required
          error={attempted === 'correction' ? reasonError : undefined}
        >
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <ErrorText>{errorFor('correction')}</ErrorText>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy.isBusy('correction')}
            onClick={(event) => {
              event.preventDefault();
              if (!terminalEvent) return;
              if (rejectInvalid('correction', { 'equipment-correction-reason': reasonError })) return;
              perform(
                'correction',
                () =>
                  correctInstalledEquipmentTerminalAction({
                    equipmentId: item.id,
                    expectedVersion: item.version,
                    correctsEventId: terminalEvent.id,
                    effectiveAt: new Date().toISOString(),
                    reason,
                    idempotencyKey: crypto.randomUUID(),
                  }),
                () => onOpenChange(false),
              );
            }}
          >
            {busy.isBusy('correction') && <Loader2 className="size-4 animate-spin" />}
            Korrektur festhalten
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type EquipmentArchiveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: EquipmentDetailActions;
};

export function EquipmentArchiveDialog({
  open,
  onOpenChange,
  actions,
}: EquipmentArchiveDialogProps): ReactElement {
  const { busy, item, reason, setReason, reasonError, attempted, errorFor } = actions;
  const { perform, rejectInvalid } = actions;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange} pending={busy.isBusy('archive')}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {item.archivedAt ? 'Anlage wiederherstellen?' : 'Anlage archivieren?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Die Identität, Dokumente, Arbeitsbezüge und Historie bleiben erhalten.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field
          label="Begründung"
          htmlFor="equipment-archive-reason"
          required
          error={attempted === 'archive' ? reasonError : undefined}
        >
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <ErrorText>{errorFor('archive')}</ErrorText>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy.isBusy('archive')}
            onClick={(event) => {
              event.preventDefault();
              if (rejectInvalid('archive', { 'equipment-archive-reason': reasonError })) return;
              perform(
                'archive',
                () =>
                  setInstalledEquipmentArchived({
                    equipmentId: item.id,
                    expectedVersion: item.version,
                    archived: !item.archivedAt,
                    reason,
                    idempotencyKey: crypto.randomUUID(),
                  }),
                () => onOpenChange(false),
              );
            }}
          >
            {busy.isBusy('archive') && <Loader2 className="size-4 animate-spin" />}
            {item.archivedAt ? 'Wiederherstellen' : 'Archivieren'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
