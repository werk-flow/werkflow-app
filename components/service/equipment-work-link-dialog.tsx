'use client';

import { useState, type ReactElement } from 'react';

import { RegionLoadError } from '@/components/shared/region-load-error';
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
import { setInstalledEquipmentWorkLink } from '@/lib/installed-equipment/actions';
import type { Job, ProjectWithDetails } from '@/lib/jobs/types';
import type { EquipmentDetailActions } from './use-equipment-detail-actions';

export type EquipmentWorkTargets = { jobs: Job[]; projects: ProjectWithDetails[] };

type EquipmentWorkLinkDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: EquipmentDetailActions;
  /** Null when the customer's work could not be read: the dialog shows the failure instead of empty choices. */
  work: EquipmentWorkTargets | null;
};

/** Links a job or project of the same site to the equipment. Stays mounted, so the selection survives a cancel; a link clears it. */
export function EquipmentWorkLinkDialog({
  open,
  onOpenChange,
  actions,
  work,
}: EquipmentWorkLinkDialogProps): ReactElement {
  const { busy, item, attempted, errorFor, perform, rejectInvalid } = actions;
  const [workTargetType, setWorkTargetType] = useState<'job' | 'project'>('job');
  const [workTargetId, setWorkTargetId] = useState('');
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
            if (busy.isBusy('work-link') || !work) return;
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
            {work ? (
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
                    options={(workTargetType === 'job' ? work.jobs : work.projects)
                      .filter((target) => target.siteId === item.siteId)
                      .map((target) => ({
                        value: target.id,
                        label:
                          workTargetType === 'job'
                            ? `${(target as Job).jobNumber ?? 'Ohne Nummer'} · ${(target as Job).title}`
                            : `${(target as ProjectWithDetails).projectNumber ?? 'Ohne Nummer'} · ${(target as ProjectWithDetails).name}`,
                      }))}
                    placeholder="Auswählen"
                    searchPlaceholder="Suchen…"
                  />
                </Field>
              </div>
            ) : (
              <RegionLoadError>
                Aufträge und Projekte dieses Kunden konnten nicht geladen werden.
              </RegionLoadError>
            )}
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
