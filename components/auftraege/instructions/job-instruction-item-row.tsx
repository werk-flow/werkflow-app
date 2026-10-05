'use client';

import { ArrowDown, ArrowUp, Check, Settings2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { PlainButton } from '@/components/ui/plain-button';
import { Textarea } from '@/components/ui/textarea';
import type { JobInstructionItemWithDetails } from '@/lib/jobs/types';
import { cn, formatGermanDateTime } from '@/lib/utils';
import type { JobInstructionRowActions } from './job-instruction-row-actions';
import { resizeTextareaElement } from './job-instruction-textarea';
import type { useJobInstructionItemEditing } from './use-job-instruction-item-editing';
import type { RenderedInstructionItem } from './use-job-instruction-item-list';

function getActorName(actor: JobInstructionItemWithDetails['creator'] | null | undefined): string {
  if (!actor) return 'Unbekannt';

  const fullName = [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim();
  return fullName || actor.email || 'Unbekannt';
}

type JobInstructionItemRowProps = {
  item: RenderedInstructionItem;
  items: RenderedInstructionItem[];
  isAdminOrManager: boolean;
  readOnly: boolean;
  isBusy: (id: string) => boolean;
  editing: ReturnType<typeof useJobInstructionItemEditing>;
  rowActions: JobInstructionRowActions;
  focusDraft: () => void;
  setDetailsItem: (item: JobInstructionItemWithDetails) => void;
};

export function JobInstructionItemRow({
  item,
  items,
  isAdminOrManager,
  readOnly,
  isBusy,
  editing,
  rowActions,
  focusDraft,
  setDetailsItem,
}: JobInstructionItemRowProps) {
  const { editingValues, setEditingValues, itemTextareaRefs, handleSaveExistingItem } = editing;
  const { handleToggleItem } = rowActions;
  const itemIndex = items.findIndex((currentItem) => currentItem.id === item.id);
  const editingValue = editingValues[item.id] ?? item.content;
  const isRowBusy = isBusy(item.id);
  const creatorLabel = `Erstellt von ${getActorName(item.creator)} · ${formatGermanDateTime(item.createdAt)}`;
  const statusLabel = item.lastStatusChangedAt
    ? `Zuletzt ${item.isCompleted ? 'erledigt' : 'offen'} von ${getActorName(item.lastStatusChangedByProfile)} · ${formatGermanDateTime(item.lastStatusChangedAt)}`
    : null;

  return (
    <div
      data-testid="job-instruction-item"
      data-row-id={item.id}
      className={cn(
        'min-w-0 w-full rounded-md border px-3 py-3 transition-colors',
        item.isCompleted && 'border-primary/30 bg-primary/5',
        item.isOptimistic && 'opacity-80',
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <PlainButton
          type="button"
          onClick={() => {
            if (!readOnly) void handleToggleItem(item);
          }}
          disabled={readOnly || isRowBusy}
          aria-busy={isRowBusy}
          aria-label={
            readOnly
              ? item.isCompleted
                ? 'Punkt erledigt'
                : 'Punkt offen'
              : item.isCompleted
                ? 'Punkt als offen markieren'
                : 'Punkt als erledigt markieren'
          }
          className={cn(
            'mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-full border transition-colors sm:size-8',
            readOnly && 'cursor-default opacity-70',
            item.isCompleted
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-muted-foreground/40 bg-background text-transparent',
          )}
        >
          <Check className="size-3" />
        </PlainButton>

        <div className="min-w-0 flex-1">
          {isAdminOrManager ? (
            <Textarea
              ref={(element) => {
                if (!element) {
                  itemTextareaRefs.current.delete(item.id);
                  return;
                }

                itemTextareaRefs.current.set(item.id, element);
                resizeTextareaElement(element);
              }}
              value={editingValue}
              onChange={(event) => {
                resizeTextareaElement(event.currentTarget);
                setEditingValues((current) => ({
                  ...current,
                  [item.id]: event.target.value,
                }));
              }}
              onBlur={() => {
                void handleSaveExistingItem(item);
              }}
              onKeyDown={async (event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;

                event.preventDefault();
                if (event.shiftKey) return;
                const didSave = await handleSaveExistingItem(item);
                if (didSave) {
                  focusDraft();
                }
              }}
              aria-label="Arbeitsanweisungs-Punkt bearbeiten"
              className="field-sizing-fixed min-h-0 min-w-0 w-full max-w-full resize-none overflow-hidden border-0 !bg-transparent px-0 py-1 whitespace-pre-wrap break-words shadow-none focus-visible:ring-0 dark:!bg-transparent"
            />
          ) : (
            <p className="py-1 text-sm leading-6 whitespace-pre-wrap break-words">{item.content}</p>
          )}

          <div className="mt-2 flex items-end justify-between gap-3 text-xs text-muted-foreground">
            <div className="min-w-0 flex-1">
              <p className="break-words">{creatorLabel}</p>
              {statusLabel && <p className="mt-1 break-words">{statusLabel}</p>}
            </div>
            <InlinePending active={isRowBusy} className="self-center" />
            {isAdminOrManager && (
              <JobInstructionItemRowButtons
                item={item}
                itemIndex={itemIndex}
                itemCount={items.length}
                isRowBusy={isRowBusy}
                rowActions={rowActions}
                setDetailsItem={setDetailsItem}
              />
            )}
          </div>
          {(item.groupLabel ||
            item.requirementState === 'optional' ||
            item.predecessors.length > 0 ||
            item.evidenceRequirements.length > 0) && (
            <div className="mt-2 space-y-1 rounded-md bg-muted/35 px-2.5 py-2 text-xs text-muted-foreground">
              <p>
                {[
                  item.groupLabel,
                  item.itemKind === 'task' ? 'Aufgabe' : 'Checkliste',
                  item.requirementState === 'optional' ? 'Optional' : 'Erforderlich',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {item.predecessors.length > 0 && (
                <p>Voraussetzung: {item.predecessors.map((entry) => entry.content).join(', ')}</p>
              )}
              {item.evidenceRequirements.map((evidence) => (
                <p key={evidence.id}>
                  {evidence.fulfillment ? 'Nachweis erfüllt' : 'Nachweis erwartet'}: {evidence.description}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type JobInstructionItemRowButtonsProps = Pick<
  JobInstructionItemRowProps,
  'item' | 'rowActions' | 'setDetailsItem'
> & {
  itemIndex: number;
  itemCount: number;
  isRowBusy: boolean;
};

function JobInstructionItemRowButtons({
  item,
  itemIndex,
  itemCount,
  isRowBusy,
  rowActions,
  setDetailsItem,
}: JobInstructionItemRowButtonsProps) {
  const { handleMoveItem, handleDeleteItem, isReorderingDisabled } = rowActions;

  return (
    <div className="flex shrink-0 self-end gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => setDetailsItem(item)}
        aria-label="Eintragsdetails bearbeiten"
      >
        <Settings2 className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground"
        onClick={() => handleMoveItem(item.id, -1)}
        disabled={itemIndex <= 0 || isReorderingDisabled}
        aria-label="Punkt nach oben verschieben"
      >
        <ArrowUp className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground"
        onClick={() => handleMoveItem(item.id, 1)}
        disabled={itemIndex === itemCount - 1 || isReorderingDisabled}
        aria-label="Punkt nach unten verschieben"
      >
        <ArrowDown className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-destructive"
        onClick={() => handleDeleteItem(item)}
        disabled={isRowBusy}
        aria-label="Punkt löschen"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
