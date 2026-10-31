'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableMultiSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DOCUMENT_CATEGORIES } from '@/lib/documents/types';
import {
  WORK_TEMPLATE_ITEM_KINDS,
  WORK_TEMPLATE_REQUIREMENT_STATES,
  type WorkTemplateDraft,
} from '@/lib/work-templates/types';

import { move, newId } from './work-template-editor-shared';

type WorkTemplateItemDraft = WorkTemplateDraft['items'][number];
type WorkTemplateEvidenceDraft = WorkTemplateDraft['evidence'][number];

/** The draft without the item and the evidence and dependencies that name it. */
function withoutItem(draft: WorkTemplateDraft, id: string): WorkTemplateDraft {
  return {
    ...draft,
    items: draft.items.filter((item) => item.id !== id),
    evidence: draft.evidence.filter((item) => item.templateItemId !== id),
    dependencies: draft.dependencies.filter(
      (item) => item.predecessorItemId !== id && item.dependentItemId !== id,
    ),
  };
}

/** The draft with exactly these predecessors for one item; a kept dependency keeps its id. */
function withPredecessors(
  draft: WorkTemplateDraft,
  dependentItemId: string,
  predecessorItemIds: string[],
): WorkTemplateDraft {
  const existing = new Map(
    draft.dependencies
      .filter((entry) => entry.dependentItemId === dependentItemId)
      .map((entry) => [entry.predecessorItemId, entry]),
  );
  return {
    ...draft,
    dependencies: [
      ...draft.dependencies.filter((entry) => entry.dependentItemId !== dependentItemId),
      ...predecessorItemIds.map(
        (predecessorItemId) =>
          existing.get(predecessorItemId) ?? { id: newId(), predecessorItemId, dependentItemId },
      ),
    ],
  };
}

export function ItemsEditor({
  draft,
  editable,
  onChange,
}: {
  draft: WorkTemplateDraft;
  editable: boolean;
  onChange: (draft: WorkTemplateDraft) => void;
}) {
  function addItem() {
    const id = newId();
    onChange({
      ...draft,
      items: [
        ...draft.items,
        {
          id,
          itemKind: 'task',
          content: '',
          requirementState: 'required',
          groupLabel: null,
          notes: null,
          sortOrder: draft.items.length,
        },
      ],
    });
  }
  function patchItem(index: number, patch: Partial<WorkTemplateItemDraft>) {
    onChange({
      ...draft,
      items: draft.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    });
  }
  function removeItem(id: string) {
    onChange(withoutItem(draft, id));
  }
  function replacePredecessors(dependentItemId: string, predecessorItemIds: string[]): void {
    onChange(withPredecessors(draft, dependentItemId, predecessorItemIds));
  }
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Aufgaben und Checkliste</h3>
          <p className="text-sm text-muted-foreground">
            Dieselben Einträge erscheinen später in der bestehenden Checkliste.
          </p>
        </div>
        {editable && (
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            <Plus className="size-4" />
            Eintrag
          </Button>
        )}
      </div>
      {draft.items.length === 0 && (
        <EmptyState size="compact" title="Noch keine Aufgaben oder Checklistenpunkte." />
      )}
      {draft.items.map((item, index) => (
        <WorkTemplateItemCard
          key={item.id}
          item={item}
          index={index}
          draft={draft}
          editable={editable}
          onChange={onChange}
          onPatchItem={patchItem}
          onRemoveItem={removeItem}
          onReplacePredecessors={replacePredecessors}
        />
      ))}
    </section>
  );
}

function WorkTemplateItemCard({
  item,
  index,
  draft,
  editable,
  onChange,
  onPatchItem: patchItem,
  onRemoveItem: removeItem,
  onReplacePredecessors: replacePredecessors,
}: {
  item: WorkTemplateItemDraft;
  index: number;
  draft: WorkTemplateDraft;
  editable: boolean;
  onChange: (draft: WorkTemplateDraft) => void;
  onPatchItem: (index: number, patch: Partial<WorkTemplateItemDraft>) => void;
  onRemoveItem: (id: string) => void;
  onReplacePredecessors: (dependentItemId: string, predecessorItemIds: string[]) => void;
}) {
  return (
    <Card className="gap-3 py-4" data-testid="work-template-item" data-row-id={item.id}>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_150px_150px_auto]">
          <Field label="Bezeichnung" htmlFor={`item-${item.id}`}>
            <Input
              value={item.content}
              disabled={!editable}
              onChange={(event) => patchItem(index, { content: event.target.value })}
            />
          </Field>
          <WorkTemplateItemClassification
            item={item}
            editable={editable}
            onPatch={(patch) => patchItem(index, patch)}
          />
          {editable && (
            <WorkTemplateItemOrderButtons
              isFirst={index === 0}
              isLast={index === draft.items.length - 1}
              onMove={(direction) => onChange({ ...draft, items: move(draft.items, index, direction) })}
              onRemove={() => removeItem(item.id)}
            />
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Gruppe" htmlFor={`group-${item.id}`}>
            <Input
              value={item.groupLabel ?? ''}
              disabled={!editable}
              onChange={(event) => patchItem(index, { groupLabel: event.target.value || null })}
              placeholder="z. B. Inbetriebnahme"
            />
          </Field>
          <WorkTemplateItemPredecessorsField
            item={item}
            draft={draft}
            editable={editable}
            onReplacePredecessors={replacePredecessors}
          />
        </div>
        <Field label="Hinweise" htmlFor={`notes-${item.id}`}>
          <Textarea
            value={item.notes ?? ''}
            disabled={!editable}
            onChange={(event) => patchItem(index, { notes: event.target.value || null })}
          />
        </Field>
        <WorkTemplateEvidenceEditor item={item} draft={draft} editable={editable} onChange={onChange} />
      </CardContent>
    </Card>
  );
}

function WorkTemplateItemPredecessorsField({
  item,
  draft,
  editable,
  onReplacePredecessors: replacePredecessors,
}: {
  item: WorkTemplateItemDraft;
  draft: WorkTemplateDraft;
  editable: boolean;
  onReplacePredecessors: (dependentItemId: string, predecessorItemIds: string[]) => void;
}) {
  const predecessorIds = draft.dependencies
    .filter((entry) => entry.dependentItemId === item.id)
    .map((entry) => entry.predecessorItemId);
  return (
    <Field label="Voraussetzungen">
      <SearchableMultiSelect
        ariaLabel={`Voraussetzungen für ${item.content || 'Eintrag'}`}
        options={draft.items
          .filter((other) => other.id !== item.id)
          .map((other) => ({ value: other.id, label: other.content || 'Unbenannter Eintrag' }))}
        selectedIds={predecessorIds}
        onSelectionChange={(ids) => replacePredecessors(item.id, ids)}
        placeholder="Keine Voraussetzungen"
        searchPlaceholder="Eintrag suchen…"
        emptyMessage="Kein anderer Eintrag"
        disabled={!editable}
      />
    </Field>
  );
}

function WorkTemplateItemClassification({
  item,
  editable,
  onPatch,
}: {
  item: WorkTemplateItemDraft;
  editable: boolean;
  onPatch: (patch: Partial<WorkTemplateItemDraft>) => void;
}) {
  return (
    <>
      <Field label="Art" htmlFor={`kind-${item.id}`}>
        <Select
          value={item.itemKind}
          disabled={!editable}
          onValueChange={(value) => {
            const itemKind = WORK_TEMPLATE_ITEM_KINDS.find((candidate) => candidate === value);
            if (itemKind) onPatch({ itemKind });
          }}
        >
          <SelectTrigger id={`kind-${item.id}`} aria-label={`Art für ${item.content || 'Eintrag'}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="task">Aufgabe</SelectItem>
            <SelectItem value="checklist">Checkliste</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Verbindlichkeit" htmlFor={`requirement-${item.id}`}>
        <Select
          value={item.requirementState}
          disabled={!editable}
          onValueChange={(value) => {
            const requirementState = WORK_TEMPLATE_REQUIREMENT_STATES.find(
              (candidate) => candidate === value,
            );
            if (requirementState) onPatch({ requirementState });
          }}
        >
          <SelectTrigger
            id={`requirement-${item.id}`}
            aria-label={`Verbindlichkeit für ${item.content || 'Eintrag'}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="required">Erforderlich</SelectItem>
            <SelectItem value="optional">Optional</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}

function WorkTemplateItemOrderButtons({
  isFirst,
  isLast,
  onMove,
  onRemove,
}: {
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-end gap-1">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={isFirst}
        onClick={() => onMove(-1)}
        aria-label="Eintrag nach oben"
      >
        <ArrowUp className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={isLast}
        onClick={() => onMove(1)}
        aria-label="Eintrag nach unten"
      >
        <ArrowDown className="size-4" />
      </Button>
      <Button type="button" size="icon" variant="ghost" onClick={onRemove} aria-label="Eintrag löschen">
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function WorkTemplateEvidenceEditor({
  item,
  draft,
  editable,
  onChange,
}: {
  item: WorkTemplateItemDraft;
  draft: WorkTemplateDraft;
  editable: boolean;
  onChange: (draft: WorkTemplateDraft) => void;
}) {
  const evidence = draft.evidence.filter((entry) => entry.templateItemId === item.id);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Erwartete Nachweise</Label>
        {editable && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange({
                ...draft,
                evidence: [
                  ...draft.evidence,
                  {
                    id: newId(),
                    templateItemId: item.id,
                    description: '',
                    documentCategory: 'photo',
                    sortOrder: evidence.length,
                  },
                ],
              })
            }
          >
            <Plus className="size-4" />
            Nachweis
          </Button>
        )}
      </div>
      {evidence.map((entry) => (
        <WorkTemplateEvidenceRow
          key={entry.id}
          entry={entry}
          draft={draft}
          editable={editable}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function WorkTemplateEvidenceRow({
  entry,
  draft,
  editable,
  onChange,
}: {
  entry: WorkTemplateEvidenceDraft;
  draft: WorkTemplateDraft;
  editable: boolean;
  onChange: (draft: WorkTemplateDraft) => void;
}) {
  function updateEntry(update: (current: WorkTemplateEvidenceDraft) => WorkTemplateEvidenceDraft) {
    onChange({
      ...draft,
      evidence: draft.evidence.map((current) => (current.id === entry.id ? update(current) : current)),
    });
  }
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_160px_auto]">
      <Input
        aria-label="Nachweisbeschreibung"
        value={entry.description}
        disabled={!editable}
        onChange={(event) => updateEntry((current) => ({ ...current, description: event.target.value }))}
        placeholder="z. B. Foto der Dichtheitsprüfung"
      />
      <Select
        value={entry.documentCategory}
        disabled={!editable}
        onValueChange={(value) => {
          const documentCategory = DOCUMENT_CATEGORIES.find((candidate) => candidate === value);
          if (documentCategory) updateEntry((current) => ({ ...current, documentCategory }));
        }}
      >
        <SelectTrigger aria-label="Dokumentkategorie">
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
      {editable && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() =>
            onChange({
              ...draft,
              evidence: draft.evidence.filter((current) => current.id !== entry.id),
            })
          }
          aria-label="Nachweiserwartung löschen"
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </div>
  );
}
