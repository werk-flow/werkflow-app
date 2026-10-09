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
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { linkInstalledEquipmentSource } from '@/lib/installed-equipment/actions';
import type { EquipmentDetailActions } from './use-equipment-detail-actions';
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

type EquipmentSourceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: EquipmentDetailActions;
};

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
}: EquipmentSourceDialogProps): ReactElement {
  const { busy, item, reason, setReason, reasonError, attempted, errorFor, perform, rejectInvalid } = actions;
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
  const ownWorkLabel = kind === 'project' ? 'Das Projekt selbst' : 'Der Auftrag selbst';

  function submitSource(): void {
    if (busy.isBusy('source')) return;
    if (rejectInvalid('source', { 'equipment-source': sourceError, 'equipment-source-reason': reasonError }))
      return;
    const target = exactOption
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
            submitSource();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <div className="space-y-4">
              <SourceKindField
                kind={kind}
                onKindChange={(value) => {
                  setKind(value);
                  setWorkId('');
                  setExactValue('');
                }}
              />
              {kind === 'document' ? (
                <Field
                  label="Dokument"
                  htmlFor="equipment-source"
                  required
                  error={attempted === 'source' ? sourceError : undefined}
                >
                  <SearchableSelect
                    value={exactValue}
                    onChange={setExactValue}
                    options={exact.options}
                    loading={exact.loading}
                    loadError={exact.error}
                    onRetryLoad={exact.error ? exact.retry : undefined}
                    placeholder="Dokument auswählen"
                    searchPlaceholder="Dokument suchen…"
                    emptyMessage="Noch keine Dokumente verknüpft"
                  />
                </Field>
              ) : (
                <>
                  <Field
                    label={KIND_LABELS[kind]}
                    htmlFor="equipment-source"
                    required
                    error={attempted === 'source' ? sourceError : undefined}
                  >
                    <SearchableSelect
                      value={workId}
                      onChange={(value) => {
                        setWorkId(value);
                        setExactValue('');
                      }}
                      options={workSearch.options}
                      onSearchChange={workSearch.onSearchChange}
                      loading={workSearch.loading}
                      loadError={workSearch.loadError}
                      onRetryLoad={workSearch.onRetryLoad}
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
                        onChange={setExactValue}
                        options={exact.options}
                        loading={exact.loading}
                        loadError={exact.error}
                        onRetryLoad={exact.error ? exact.retry : undefined}
                        allowNone
                        noneLabel={ownWorkLabel}
                        placeholder={ownWorkLabel}
                        searchPlaceholder="Nachweis suchen…"
                        emptyMessage="Keine Arbeitsnachweise oder Übergaben vorhanden"
                      />
                    </Field>
                  )}
                </>
              )}
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
