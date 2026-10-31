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
import { Textarea } from '@/components/ui/textarea';
import { useJobEntityOptions, type JobEntityOptionsState } from '@/hooks/use-job-entity-options';
import { linkInstalledEquipmentSource } from '@/lib/installed-equipment/actions';
import type { EquipmentActionDialogProps } from './use-equipment-detail-actions';
import { useEquipmentSourceOptions } from './use-equipment-source-options';

type SourceKind = 'job' | 'project' | 'document';

const KIND_LABELS: Record<SourceKind, string> = {
  job: 'Auftrag',
  project: 'Projekt',
  document: 'Dokument der Anlage',
};

const MISSING_SOURCE: Record<SourceKind, string> = {
  job: 'Bitte wähle einen Auftrag.',
  project: 'Bitte wähle ein Projekt.',
  document: 'Bitte wähle ein Dokument.',
};

function SourceKindField({
  kind,
  onKindChange,
}: {
  kind: SourceKind;
  onKindChange: (kind: SourceKind) => void;
}): ReactElement {
  return (
    <Field label="Art" htmlFor="equipment-source-type">
      <Select value={kind} onValueChange={onKindChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

type SourceWork = { type: 'job' | 'project'; id: string };
type SourceOptions = ReturnType<typeof useEquipmentSourceOptions>;

/** The exact option when one is chosen, otherwise the job or project itself. */
function sourceTarget(exactOption: SourceOptions['options'][number] | undefined, work: SourceWork | null) {
  return exactOption
    ? {
        targetType: exactOption.targetType,
        targetId: exactOption.targetId,
        ...(exactOption.documentVersionNumber !== undefined
          ? { documentVersionNumber: exactOption.documentVersionNumber }
          : {}),
      }
    : work
      ? { targetType: work.type, targetId: work.id }
      : null;
}

/** The chosen kind, work and exact source, their searches and the link submit. */
function useEquipmentSourceForm({
  actions,
  onOpenChange,
}: Pick<EquipmentActionDialogProps, 'actions' | 'onOpenChange'>) {
  const { busy, item, reason, reasonError, perform, rejectInvalid } = actions;
  const [kind, setKind] = useState<SourceKind>('job');
  const [workId, setWorkId] = useState('');
  const [exactValue, setExactValue] = useState('');
  const workSearch = useJobEntityOptions(
    {
      kind: kind === 'project' ? 'projects' : 'jobs',
      purpose: 'equipment-work',
      clientId: item.clientId,
      siteId: item.siteId,
    },
    kind !== 'document' && workId ? [workId] : [],
  );
  const work = kind !== 'document' && workId ? { type: kind, id: workId } : null;
  const exact = useEquipmentSourceOptions(item.id, work, kind === 'document' || work !== null);
  const exactOption = exact.options.find((option) => option.value === exactValue);
  const sourceError = (kind === 'document' ? exactOption : workId) ? undefined : MISSING_SOURCE[kind];

  function submitSource(): void {
    if (busy.isBusy('source')) return;
    if (rejectInvalid('source', { 'equipment-source': sourceError, 'equipment-source-reason': reasonError }))
      return;
    const target = sourceTarget(exactOption, work);
    if (!target) return;
    perform(
      'source',
      () =>
        linkInstalledEquipmentSource({
          equipmentId: item.id,
          expectedVersion: item.version,
          ...target,
          reason,
          idempotencyKey: crypto.randomUUID(),
        }),
      () => onOpenChange(false),
    );
  }

  function changeKind(value: SourceKind): void {
    setKind(value);
    setWorkId('');
    setExactValue('');
  }

  function changeWork(value: string): void {
    setWorkId(value);
    setExactValue('');
  }

  return {
    kind,
    changeKind,
    workId,
    changeWork,
    exactValue,
    setExactValue,
    workSearch,
    work,
    exact,
    sourceError,
    submitSource,
  };
}

type SourceWorkFieldsProps = {
  kind: 'job' | 'project';
  workId: string;
  onWorkChange: (value: string) => void;
  workSearch: JobEntityOptionsState;
  work: SourceWork | null;
  exact: SourceOptions;
  exactValue: string;
  onExactChange: (value: string) => void;
  error: string | undefined;
};

/** The job or project, then optionally its exact Arbeitsnachweis or handover release. */
function SourceWorkFields({
  kind,
  workId,
  onWorkChange,
  workSearch,
  work,
  exact,
  exactValue,
  onExactChange,
  error,
}: SourceWorkFieldsProps): ReactElement {
  const ownWorkLabel = kind === 'project' ? 'Das Projekt selbst' : 'Der Auftrag selbst';
  return (
    <>
      <Field label={KIND_LABELS[kind]} htmlFor="equipment-source" required error={error}>
        <SearchableSelect
          value={workId}
          onChange={onWorkChange}
          options={workSearch.options}
          onSearchChange={workSearch.onSearchChange}
          loading={workSearch.loading}
          loadFailure={workSearch.loadFailure}
          onLoadMore={workSearch.onLoadMore}
          placeholder={kind === 'job' ? 'Auftrag auswählen' : 'Projekt auswählen'}
          searchPlaceholder={kind === 'job' ? 'Auftrag suchen…' : 'Projekt suchen…'}
          emptyMessage={
            kind === 'job'
              ? 'Kein Auftrag an diesem Einsatzort gefunden'
              : 'Kein Projekt an diesem Einsatzort gefunden'
          }
        />
      </Field>
      {work && (
        <Field label="Genauer Stand" htmlFor="equipment-source-detail">
          <SearchableSelect
            value={exactValue}
            onChange={onExactChange}
            options={exact.options}
            loading={exact.loading}
            loadFailure={exact.loadFailure}
            allowNone
            noneLabel={ownWorkLabel}
            placeholder={ownWorkLabel}
            searchPlaceholder="Nachweis suchen…"
            emptyMessage="Keine Arbeitsnachweise oder Übergaben vorhanden"
          />
        </Field>
      )}
    </>
  );
}

/** The equipment's document, or the job or project with its exact source. */
function SourceTargetFields({
  source,
  error,
}: {
  source: ReturnType<typeof useEquipmentSourceForm>;
  error: string | undefined;
}): ReactElement {
  const { kind, exact, exactValue, setExactValue } = source;
  return kind === 'document' ? (
    <Field label="Dokument" htmlFor="equipment-source" required error={error}>
      <SearchableSelect
        value={exactValue}
        onChange={setExactValue}
        options={exact.options}
        loading={exact.loading}
        loadFailure={exact.loadFailure}
        placeholder="Dokument auswählen"
        searchPlaceholder="Dokument suchen…"
        emptyMessage="Noch keine Dokumente verknüpft"
      />
    </Field>
  ) : (
    <SourceWorkFields
      kind={kind}
      workId={source.workId}
      onWorkChange={source.changeWork}
      workSearch={source.workSearch}
      work={source.work}
      exact={exact}
      exactValue={exactValue}
      onExactChange={setExactValue}
      error={error}
    />
  );
}

/**
 * Links an exact source to the equipment. A job or project is searched on the
 * server first; its Arbeitsnachweis revisions and handover releases are read
 * only once it is chosen. Documents are the equipment's own. Mount it per
 * opening, so every opening starts empty.
 */
export function EquipmentSourceDialog({
  open,
  onOpenChange,
  actions,
}: EquipmentActionDialogProps): ReactElement {
  const { busy, reason, setReason, reasonError, attempted, errorFor } = actions;
  const source = useEquipmentSourceForm({ actions, onOpenChange });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={busy.isBusy('source')}>
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
            source.submitSource();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <div className="space-y-4">
              <SourceKindField kind={source.kind} onKindChange={source.changeKind} />
              <SourceTargetFields
                source={source}
                error={attempted === 'source' ? source.sourceError : undefined}
              />
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
              onClick={() => onOpenChange(false)}
              disabled={busy.isBusy('source')}
            >
              Abbrechen
            </Button>
            <Button pending={busy.isBusy('source')} type="submit" disabled={busy.isBusy('source')}>
              Verknüpfen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
