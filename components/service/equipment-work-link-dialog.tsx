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
import { useJobEntityOptions, type JobEntityOptionsState } from '@/hooks/use-job-entity-options';
import { setInstalledEquipmentWorkLink } from '@/lib/installed-equipment/actions';
import type { EquipmentActionDialogProps } from './use-equipment-detail-actions';

type WorkTargetType = 'job' | 'project';

/** Links the chosen work, unless a link is running or no work is chosen. */
function submitWorkLink({
  actions,
  workTargetType,
  workTargetId,
  workTargetError,
  onLinked,
}: {
  actions: EquipmentActionDialogProps['actions'];
  workTargetType: WorkTargetType;
  workTargetId: string;
  workTargetError: string | undefined;
  onLinked: () => void;
}): void {
  const { busy, item, perform, rejectInvalid } = actions;
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
    onLinked,
  );
}

function WorkTargetTypeField({
  value,
  onChange,
}: {
  value: WorkTargetType;
  onChange: (value: WorkTargetType) => void;
}): ReactElement {
  return (
    <Field label="Art" htmlFor="equipment-work-type">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="job">Auftrag</SelectItem>
          <SelectItem value="project">Projekt</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

function WorkTargetField({
  workTargetType,
  workTargetId,
  onChange,
  workSearch,
  error,
}: {
  workTargetType: WorkTargetType;
  workTargetId: string;
  onChange: (value: string) => void;
  workSearch: JobEntityOptionsState;
  error: string | undefined;
}): ReactElement {
  return (
    <Field
      label={workTargetType === 'job' ? 'Auftrag' : 'Projekt'}
      htmlFor="equipment-work-target"
      required
      error={error}
    >
      <SearchableSelect
        value={workTargetId}
        onChange={onChange}
        options={workSearch.options}
        onSearchChange={workSearch.onSearchChange}
        loading={workSearch.loading}
        loadFailure={workSearch.loadFailure}
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
  );
}

/** The chosen work type and work, with the server search of the item's customer and site. */
function useWorkLinkTarget(item: EquipmentActionDialogProps['actions']['item']) {
  const [workTargetType, setWorkTargetType] = useState<WorkTargetType>('job');
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
  return { workTargetType, setWorkTargetType, workTargetId, setWorkTargetId, workSearch, workTargetError };
}

/**
 * Links a job or project of the same customer and site to the equipment. The
 * choices are searched on the server when the picker opens. Stays mounted, so
 * the selection survives a cancel; a link clears it.
 */
export function EquipmentWorkLinkDialog({
  open,
  onOpenChange,
  actions,
}: EquipmentActionDialogProps): ReactElement {
  const { busy, item, attempted, errorFor } = actions;
  const { workTargetType, setWorkTargetType, workTargetId, setWorkTargetId, workSearch, workTargetError } =
    useWorkLinkTarget(item);
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
            submitWorkLink({
              actions,
              workTargetType,
              workTargetId,
              workTargetError,
              onLinked: () => {
                setWorkTargetId('');
                onOpenChange(false);
              },
            });
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <div className="space-y-4">
              <WorkTargetTypeField
                value={workTargetType}
                onChange={(value) => {
                  setWorkTargetType(value);
                  setWorkTargetId('');
                }}
              />
              <WorkTargetField
                workTargetType={workTargetType}
                workTargetId={workTargetId}
                onChange={setWorkTargetId}
                workSearch={workSearch}
                error={attempted === 'work-link' ? workTargetError : undefined}
              />
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
