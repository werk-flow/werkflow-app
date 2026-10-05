'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field } from '@/components/ui/field';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableMultiSelect } from '@/components/ui/searchable-select';
import { ErrorText } from '@/components/ui/error-text';
import { useServerAction } from '@/hooks/use-server-action';
import { updateInstructionItemDetails } from '@/lib/jobs/instruction-items-actions';
import type { JobInstructionItemWithDetails } from '@/lib/jobs/types';
import { generateDraftId } from './job-instruction-draft-id';

type InstructionItemKind = JobInstructionItemWithDetails['itemKind'];
type InstructionRequirementState = JobInstructionItemWithDetails['requirementState'];
type InstructionEvidenceDraft = JobInstructionItemWithDetails['evidenceRequirements'][number] & {
  sortOrder: number;
};

export function InstructionItemDetailsDialog({
  item,
  allItems,
  onClose,
  onSaved,
}: {
  item: JobInstructionItemWithDetails | null;
  allItems: JobInstructionItemWithDetails[];
  onClose: () => void;
  onSaved: (item: JobInstructionItemWithDetails) => void;
}) {
  const [itemKind, setItemKind] = useState(item?.itemKind ?? 'checklist');
  const [requirementState, setRequirementState] = useState(item?.requirementState ?? 'required');
  const [groupLabel, setGroupLabel] = useState(item?.groupLabel ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [predecessorIds, setPredecessorIds] = useState(item?.predecessors.map((entry) => entry.id) ?? []);
  const [evidence, setEvidence] = useState(
    item?.evidenceRequirements.map((entry, index) => ({
      ...entry,
      sortOrder: index,
    })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const { run: runSaveDetails, isPending } = useServerAction(updateInstructionItemDetails);
  if (!item) return null;
  const itemId = item.id;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await runSaveDetails({
        itemId,
        itemKind,
        requirementState,
        groupLabel,
        notes,
        evidence,
        predecessorItemIds: predecessorIds,
      });
      if (!result.success) {
        setError(
          result.error === 'instruction_dependency_cycle'
            ? 'Abhängigkeiten dürfen keinen Kreis bilden.'
            : 'Die Eintragsdetails konnten nicht gespeichert werden.',
        );
        return;
      }
      onSaved(result.item);
    } catch {
      setError('Die Eintragsdetails konnten nicht gespeichert werden.');
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={isPending}>
      <DialogContent size="xl">
        <form onSubmit={save} className="contents">
          <DialogHeader>
            <DialogTitle>Eintragsdetails bearbeiten</DialogTitle>
            <DialogDescription>
              Die Angaben gehören zu diesem Auftrag oder Projekt und ändern die Vorlage nicht.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <InstructionItemKindFields
              itemKind={itemKind}
              setItemKind={setItemKind}
              requirementState={requirementState}
              setRequirementState={setRequirementState}
            />
            <Field label="Gruppe" htmlFor="instruction-group">
              <Input value={groupLabel} onChange={(event) => setGroupLabel(event.target.value)} />
            </Field>
            <Field label="Voraussetzungen">
              <SearchableMultiSelect
                ariaLabel="Voraussetzungen"
                options={allItems
                  .filter((entry) => entry.id !== item.id)
                  .map((entry) => ({ value: entry.id, label: entry.content }))}
                selectedIds={predecessorIds}
                onSelectionChange={setPredecessorIds}
                placeholder="Keine Voraussetzungen"
                searchPlaceholder="Eintrag suchen…"
                emptyMessage="Kein anderer Eintrag"
              />
            </Field>
            <Field label="Hinweise" htmlFor="instruction-notes">
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
            <InstructionItemEvidenceFields evidence={evidence} setEvidence={setEvidence} />
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InstructionItemKindFields({
  itemKind,
  setItemKind,
  requirementState,
  setRequirementState,
}: {
  itemKind: InstructionItemKind;
  setItemKind: (value: InstructionItemKind) => void;
  requirementState: InstructionRequirementState;
  setRequirementState: (value: InstructionRequirementState) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Art" htmlFor="instruction-kind">
        <Select value={itemKind} onValueChange={(value) => setItemKind(value as typeof itemKind)}>
          <SelectTrigger id="instruction-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="task">Aufgabe</SelectItem>
            <SelectItem value="checklist">Checkliste</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Verbindlichkeit" htmlFor="instruction-requirement">
        <Select
          value={requirementState}
          onValueChange={(value) => setRequirementState(value as typeof requirementState)}
        >
          <SelectTrigger id="instruction-requirement">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="required">Erforderlich</SelectItem>
            <SelectItem value="optional">Optional</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

function InstructionItemEvidenceFields({
  evidence,
  setEvidence,
}: {
  evidence: InstructionEvidenceDraft[];
  setEvidence: Dispatch<SetStateAction<InstructionEvidenceDraft[]>>;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Erwartete Nachweise</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            setEvidence((current) => [
              ...current,
              {
                id: generateDraftId(),
                description: '',
                documentCategory: 'photo',
                sortOrder: current.length,
              },
            ])
          }
        >
          Nachweis ergänzen
        </Button>
      </div>
      {evidence.map((entry) => (
        <div key={entry.id} className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
          <Input
            aria-label="Nachweisbeschreibung"
            value={entry.description}
            onChange={(event) =>
              setEvidence((current) =>
                current.map((value) =>
                  value.id === entry.id ? { ...value, description: event.target.value } : value,
                ),
              )
            }
          />
          <Select
            value={entry.documentCategory}
            onValueChange={(value) =>
              setEvidence((current) =>
                current.map((currentEntry) =>
                  currentEntry.id === entry.id ? { ...currentEntry, documentCategory: value } : currentEntry,
                ),
              )
            }
          >
            <SelectTrigger aria-label="Nachweiskategorie">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="photo">Foto</SelectItem>
              <SelectItem value="report">Bericht</SelectItem>
              <SelectItem value="contract">Vertrag</SelectItem>
              <SelectItem value="offer">Angebot</SelectItem>
              <SelectItem value="invoice">Rechnung</SelectItem>
              <SelectItem value="other">Sonstiges</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Nachweis entfernen"
            onClick={() => setEvidence((current) => current.filter((value) => value.id !== entry.id))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
