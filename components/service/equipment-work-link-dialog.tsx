'use client';

import { useState, type ReactElement } from 'react';

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { setInstalledEquipmentWorkLink } from '@/lib/installed-equipment/actions';
import type { EquipmentDetailActions } from './use-equipment-detail-actions';

type EquipmentWorkLinkDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: EquipmentDetailActions;
};

/**
 * Links a job or project of the same customer and site to the equipment. The
 * choices are searched on the server when the picker opens. Stays mounted, so
 * the selection survives a cancel; a link clears it.
 */
export function EquipmentWorkLinkDialog({
  open,
  onOpenChange,
  actions,
}: EquipmentWorkLinkDialogProps): ReactElement {
  const { busy, item, attempted, errorFor, perform, rejectInvalid } = actions;
  const [workTargetType, setWorkTargetType] = useState<'job' | 'project'>('job');
  const [workTargetId, setWorkTargetId] = useState('');
  const workSearch = useJobEntityOptions(
    {
      kind: workTargetType === 'job' ? 'jobs' : 'projects',
      purpose: 'equipment-work',
      clientId: item.clientId,
      siteId: item.siteId,
    },
    workTargetId ? [workTargetId] : [],
  );
  const workTargetError = workTargetId
    ? undefined
    : workTargetType === 'job'
      ? 'Bitte wähle einen Auftrag.'
      : 'Bitte wähle ein Projekt.';
  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={busy.isBusy('work-link')}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Arbeit verknüpfen</DialogTitle>
          <DialogDescription>
            Nur Arbeit desselben Kunden und Einsatzorts kann verknüpft werden. Zugewiesene Mitarbeiter sehen
            danach die kompakte Anlagenprojektion im Auftrag.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (busy.isBusy('work-link')) return;
            if (rejectInvalid('work-link', { 'equipment-work-target': workTargetError })) return;
            perform(
              'work-link',
              () =>
                setInstalledEquipmentWorkLink({
                  equipmentId: item.id,
                  expectedVersion: item.version,
                  jobId: workTargetType === 'job' ? workTargetId : null,
                  projectId: workTargetType === 'project' ? workTargetId : null,
                  linked: true,
                  reason: 'Arbeitsbezug hinzugefügt',
                  idempotencyKey: crypto.randomUUID(),
                }),
              () => {
                setWorkTargetId('');
                onOpenChange(false);
              },
            );
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <div className="space-y-4">
              <Field label="Art" htmlFor="equipment-work-type">
                <Select
                  value={workTargetType}
                  onValueChange={(value: 'job' | 'project') => {
                    setWorkTargetType(value);
                    setWorkTargetId('');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="job">Auftrag</SelectItem>
                    <SelectItem value="project">Projekt</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label={workTargetType === 'job' ? 'Auftrag' : 'Projekt'}
                htmlFor="equipment-work-target"
                required
                error={attempted === 'work-link' ? workTargetError : undefined}
              >
                <SearchableSelect
                  value={workTargetId}
                  onChange={setWorkTargetId}
                  options={workSearch.options}
                  onSearchChange={workSearch.onSearchChange}
                  loading={workSearch.loading}
                  loadError={workSearch.loadError}
                  onRetryLoad={workSearch.onRetryLoad}
                  onLoadMore={workSearch.onLoadMore}
                  placeholder="Auswählen"
                  searchPlaceholder={workTargetType === 'job' ? 'Auftrag suchen…' : 'Projekt suchen…'}
                  emptyMessage={
                    workTargetType === 'job'
                      ? 'Kein Auftrag an diesem Einsatzort gefunden'
                      : 'Kein Projekt an diesem Einsatzort gefunden'
                  }
                />
              </Field>
            </div>
            <ErrorText>{errorFor('work-link')}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy.isBusy('work-link')}
            >
              Abbrechen
            </Button>
            <Button pending={busy.isBusy('work-link')} type="submit" disabled={busy.isBusy('work-link')}>
              Verknüpfen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
