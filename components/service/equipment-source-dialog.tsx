'use client';

import { useState, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import {
  getInstalledEquipmentSourceOptions,
  linkInstalledEquipmentSource,
} from '@/lib/installed-equipment/actions';
import type { EquipmentSourceOption } from '@/lib/installed-equipment/types';
import type { EquipmentDetailActions } from './use-equipment-detail-actions';

export type EquipmentSourceDialogState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  options: EquipmentSourceOption[];
  value: string;
  setValue: (value: string) => void;
  /** Loads the available sources first; the dialog opens only when they arrived. */
  openDialog: () => void;
};

export function useEquipmentSourceDialog(actions: EquipmentDetailActions): EquipmentSourceDialogState {
  const { busy, item, setError, clearReason } = actions;
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<EquipmentSourceOption[]>([]);
  const [value, setValue] = useState('');

  function openDialog(): void {
    setError(null);
    clearReason();
    void busy.run('source-options', async () => {
      const result = await getInstalledEquipmentSourceOptions(item.id).catch(() => ({
        success: false as const,
      }));
      if (!result.success) {
        setError({
          scope: 'source-options',
          message: 'Verfügbare Herkunftsnachweise konnten nicht geladen werden.',
        });
        return;
      }
      setOptions(result.options);
      setValue('');
      setOpen(true);
    });
  }

  return { open, setOpen, options, value, setValue, openDialog };
}

type EquipmentSourceDialogProps = {
  actions: EquipmentDetailActions;
  state: EquipmentSourceDialogState;
};

export function EquipmentSourceDialog({ actions, state }: EquipmentSourceDialogProps): ReactElement {
  const { busy, item, reason, setReason, reasonError, attempted, errorFor, perform, rejectInvalid } = actions;
  const { open: sourceOpen, setOpen: setSourceOpen, options: sourceOptions } = state;
  const { value: sourceValue, setValue: setSourceValue } = state;
  const sourceError = sourceValue ? undefined : 'Bitte wähle einen Nachweis.';
  return (
    <Dialog open={sourceOpen} onOpenChange={setSourceOpen} pending={busy.isBusy('source')}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Herkunftsnachweis verknüpfen</DialogTitle>
          <DialogDescription>
            Verknüpfe den genauen Auftrag, Arbeitsnachweis, freigegebenen Übergabestand oder die exakte
            Dokumentversion. Der Bezug wird unveränderlich in der Historie festgehalten.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (busy.isBusy('source')) return;
            if (
              rejectInvalid('source', {
                'equipment-source': sourceError,
                'equipment-source-reason': reasonError,
              })
            )
              return;
            const option = sourceOptions.find((candidate) => candidate.value === sourceValue);
            if (!option) return;
            perform(
              'source',
              () =>
                linkInstalledEquipmentSource({
                  equipmentId: item.id,
                  expectedVersion: item.version,
                  targetType: option.targetType,
                  targetId: option.targetId,
                  ...(option.documentVersionNumber !== undefined
                    ? { documentVersionNumber: option.documentVersionNumber }
                    : {}),
                  reason,
                  idempotencyKey: crypto.randomUUID(),
                }),
              () => setSourceOpen(false),
            );
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <div className="space-y-4">
              <Field
                label="Nachweis"
                htmlFor="equipment-source"
                required
                error={attempted === 'source' ? sourceError : undefined}
              >
                <SearchableSelect
                  value={sourceValue}
                  onChange={setSourceValue}
                  options={sourceOptions.map((option) => ({
                    value: option.value,
                    label: option.label,
                    description: option.description,
                  }))}
                  placeholder="Nachweis auswählen"
                  searchPlaceholder="Nachweis suchen…"
                  emptyMessage="Keine passenden Nachweise verfügbar"
                />
              </Field>
              <Field
                label="Bedeutung des Nachweises"
                htmlFor="equipment-source-reason"
                required
                error={attempted === 'source' ? reasonError : undefined}
              >
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="z. B. Installation laut Übergabestand"
                />
              </Field>
            </div>
            <ErrorText>{errorFor('source')}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSourceOpen(false)}
              disabled={busy.isBusy('source')}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={busy.isBusy('source')}>
              {busy.isBusy('source') && <Loader2 className="size-4 animate-spin" />}
              Verknüpfen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
