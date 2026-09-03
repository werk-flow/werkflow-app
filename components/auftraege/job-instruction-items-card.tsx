'use client';

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ClipboardList,
  Loader2,
  Settings2,
  Trash2,
} from 'lucide-react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field } from '@/components/ui/field';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableMultiSelect } from '@/components/ui/searchable-select';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useServerAction } from '@/hooks/use-server-action';
import { cn } from '@/lib/utils';
import {
  createJobInstructionItem,
  createProjectInstructionItem,
  deleteJobInstructionItem,
  getJobInstructionItems,
  getProjectInstructionItems,
  reorderJobInstructionItems,
  reorderProjectInstructionItems,
  toggleJobInstructionItemCompletion,
  updateJobInstructionItemContent,
  updateInstructionItemDetails,
} from '@/lib/jobs/instruction-items-actions';
import type {
  JobInstructionActor,
  JobInstructionItemWithDetails,
} from '@/lib/jobs/types';

type JobInstructionItemsCardProps = {
  jobId?: string;
  projectId?: string;
  initialItems: JobInstructionItemWithDetails[];
  isAdminOrManager: boolean;
  currentUserActor: JobInstructionActor | null;
  refreshSignal?: number;
  readOnly?: boolean;
};

type DraftInstructionItem = {
  draftId: string;
  content: string;
};

type RenderedInstructionItem = JobInstructionItemWithDetails & {
  isOptimistic?: boolean;
};

const ERROR_MESSAGES: Record<string, string> = {
  content_required: 'Bitte gib einen Text für den Punkt ein.',
  not_authorized: 'Du hast keine Berechtigung für diese Aktion.',
  create_failed: 'Der Punkt konnte nicht erstellt werden.',
  update_failed: 'Der Punkt konnte nicht gespeichert werden.',
  delete_failed: 'Der Punkt konnte nicht gelöscht werden.',
  toggle_failed: 'Der Status konnte nicht geändert werden.',
  instruction_predecessor_incomplete: 'Schließe zuerst alle vorausgehenden Einträge ab.',
  instruction_item_stale_version: 'Der Eintrag wurde inzwischen geändert. Die Ansicht wird aktualisiert.',
  reorder_failed: 'Die Reihenfolge der Punkte konnte nicht gespeichert werden.',
  invalid_reorder: 'Die Reihenfolge der Punkte ist nicht mehr aktuell.',
  item_not_found: 'Der Eintrag wurde nicht gefunden.',
  job_not_found: 'Der Auftrag wurde nicht gefunden.',
  unexpected_error: 'Es ist ein unerwarteter Fehler aufgetreten.',
};

function generateDraftId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `draft-${Date.now()}`;
}

function getActorName(
  actor: JobInstructionItemWithDetails['creator'] | null | undefined
): string {
  if (!actor) return 'Unbekannt';

  const fullName = [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim();
  return fullName || actor.email || 'Unbekannt';
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function JobInstructionItemsCard({
  jobId,
  projectId,
  initialItems,
  isAdminOrManager,
  currentUserActor,
  refreshSignal = 0,
  readOnly = false,
}: JobInstructionItemsCardProps): ReactElement {
  const [items, setItems] = useState<RenderedInstructionItem[]>(initialItems);
  const [draft, setDraft] = useState<DraftInstructionItem | null>(
    isAdminOrManager
      ? {
          draftId: generateDraftId(),
          content: '',
        }
      : null
  );
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const [focusedDraftId, setFocusedDraftId] = useState<string | null>(null);
  const [detailsItem, setDetailsItem] = useState<JobInstructionItemWithDetails | null>(null);
  const { showBanner } = useBanner();
  // One busy set for every row mutation (toggle, edit, delete, reorder, and
  // the optimistic create row): the spinner sits on the affected row and the
  // other rows stay usable.
  const { run: runOnRow, isBusy, anyBusy } = useBusyIds();
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const itemTextareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  useEffect(() => {
    if (projectId) void syncItemsFromServer();
    // The project detail route does not preload these rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshSignal]);

  useEffect(() => {
    if (!isAdminOrManager) {
      setDraft(null);
      return;
    }

    setDraft((currentDraft) => {
      if (currentDraft) return currentDraft;

      return {
        draftId: generateDraftId(),
        content: '',
      };
    });
  }, [isAdminOrManager, items]);

  useEffect(() => {
    if (focusedDraftId && draft?.draftId === focusedDraftId) {
      draftTextareaRef.current?.focus();
      setFocusedDraftId(null);
    }
  }, [draft, focusedDraftId]);

  function resizeTextareaElement(textarea: HTMLTextAreaElement | null) {
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  useEffect(() => {
    resizeTextareaElement(draftTextareaRef.current);
  }, [draft?.content]);

  useEffect(() => {
    for (const textarea of itemTextareaRefs.current.values()) {
      resizeTextareaElement(textarea);
    }
  }, [items, editingValues]);

  const displayedItems = useMemo(() => {
    if (!draft) {
      return items.map((item) => ({ type: 'item' as const, item }));
    }
    return [...items.map((item) => ({ type: 'item' as const, item })), { type: 'draft' as const, draft }];
  }, [draft, items]);

  function getErrorMessage(error: string | undefined): string {
    if (!error) return ERROR_MESSAGES.unexpected_error;
    return ERROR_MESSAGES[error] ?? ERROR_MESSAGES.unexpected_error;
  }

  function showErrorBanner(message: string) {
    showBanner({ variant: 'error', message });
  }

  async function syncItemsFromServer(): Promise<RenderedInstructionItem[]> {
    const result = projectId
      ? await getProjectInstructionItems(projectId)
      : await getJobInstructionItems(jobId!);
    if (!result.success) {
      return items;
    }

    setItems(result.items);
    return result.items;
  }

  function replaceItem(nextItem: JobInstructionItemWithDetails) {
    setItems((currentItems) =>
      currentItems.map((item) => (item.id === nextItem.id ? nextItem : item))
    );
  }

  function appendItem(nextItem: JobInstructionItemWithDetails) {
    setItems((currentItems) => [...currentItems, nextItem]);
  }

  function clearEditingValue(itemId: string) {
    setEditingValues((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  // Never rejects: a failed or thrown save resets the row to the server
  // value and reports through the banner, so blur callers can drop the
  // returned flag.
  async function handleSaveExistingItem(item: JobInstructionItemWithDetails): Promise<boolean> {
    const nextValue = editingValues[item.id];
    if (nextValue === undefined || nextValue === item.content) {
      return true;
    }

    const trimmed = nextValue.trim();
    if (!trimmed) {
      clearEditingValue(item.id);
      showErrorBanner(ERROR_MESSAGES.content_required);
      return false;
    }

    let errorMessage: string | null = null;
    try {
      const result = await runOnRow(item.id, () =>
        updateJobInstructionItemContent({ itemId: item.id, content: nextValue })
      );
      if (result.success) {
        replaceItem(result.item);
        clearEditingValue(item.id);
        return true;
      }
      errorMessage = getErrorMessage(result.error);
    } catch {
      errorMessage = ERROR_MESSAGES.update_failed;
    }

    await syncItemsFromServer();
    clearEditingValue(item.id);
    showErrorBanner(errorMessage);
    return false;
  }

  function focusDraft() {
    if (!draft) return;
    setFocusedDraftId(draft.draftId);
  }

  async function handleCreateDraft(createAnotherAfter = true) {
    if (!draft) return;

    const trimmed = draft.content.trim();
    if (!trimmed) {
      return;
    }

    const draftSnapshot = draft;
    const optimisticId = `optimistic-${draftSnapshot.draftId}`;
    const optimisticItem: RenderedInstructionItem = {
      id: optimisticId,
      organizationId: '',
      jobId: jobId ?? null,
      projectId: projectId ?? null,
      itemKind: 'checklist',
      requirementState: 'required',
      groupLabel: null,
      notes: null,
      templateApplicationId: null,
      sourceTemplateItemId: null,
      content: draftSnapshot.content,
      sortOrder: items.length,
      isCompleted: false,
      completionVersion: 0,
      createdBy: currentUserActor?.userId ?? '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastStatusChangedBy: null,
      lastStatusChangedAt: null,
      creator: currentUserActor,
      lastStatusChangedByProfile: null,
      evidenceRequirements: [],
      predecessors: [],
      isOptimistic: true,
    };

    appendItem(optimisticItem);

    const nextDraftId = generateDraftId();
    if (createAnotherAfter) {
      setDraft({
        draftId: nextDraftId,
        content: '',
      });
      setFocusedDraftId(nextDraftId);
    }

    let errorMessage: string | null = null;
    try {
      const result = await runOnRow(optimisticId, () =>
        projectId
          ? createProjectInstructionItem({ projectId, content: draftSnapshot.content })
          : createJobInstructionItem({ jobId: jobId!, content: draftSnapshot.content })
      );
      if (result.success) {
        setItems((currentItems) =>
          currentItems.map((item) => (item.id === optimisticId ? result.item : item))
        );
        return;
      }
      errorMessage = getErrorMessage(result.error);
    } catch {
      errorMessage = ERROR_MESSAGES.create_failed;
    }

    // Roll the optimistic row back and hand the typed text back to the draft.
    setItems((currentItems) =>
      currentItems.filter((item) => item.id !== optimisticId)
    );
    await syncItemsFromServer();
    setDraft({
      draftId: generateDraftId(),
      content: draftSnapshot.content,
    });
    showErrorBanner(errorMessage);
  }

  async function handleToggleItem(item: JobInstructionItemWithDetails) {
    if (isBusy(item.id)) return;
    const optimisticTimestamp = new Date().toISOString();

    replaceItem({
      ...item,
      isCompleted: !item.isCompleted,
      lastStatusChangedAt: optimisticTimestamp,
      lastStatusChangedBy: currentUserActor?.userId ?? item.lastStatusChangedBy,
      lastStatusChangedByProfile:
        currentUserActor ?? item.lastStatusChangedByProfile,
      updatedAt: optimisticTimestamp,
    });

    // Optimistic flip: roll back to the previous row and surface the error
    // when the server rejects or the call throws.
    let errorMessage: string | null = null;
    try {
      const result = await runOnRow(item.id, () =>
        toggleJobInstructionItemCompletion({
          itemId: item.id,
          isCompleted: !item.isCompleted,
        })
      );
      if (result.success) {
        replaceItem(result.item);
        return;
      }
      errorMessage = getErrorMessage(result.error);
    } catch {
      errorMessage = ERROR_MESSAGES.toggle_failed;
    }

    replaceItem(item);
    await syncItemsFromServer();
    showErrorBanner(errorMessage);
  }

  async function handleDeleteItem(item: JobInstructionItemWithDetails) {
    try {
      const result = await runOnRow(item.id, () =>
        deleteJobInstructionItem({ itemId: item.id })
      );
      if (!result.success) {
        showErrorBanner(getErrorMessage(result.error));
        return;
      }
      setItems((currentItems) => currentItems.filter((entry) => entry.id !== item.id));
    } catch {
      showErrorBanner(ERROR_MESSAGES.delete_failed);
    }
  }

  async function handleMoveItem(itemId: string, direction: -1 | 1) {
    // A reorder sends the full id list, so it waits for any row mutation.
    if (anyBusy || items.some((item) => item.isOptimistic)) return;

    const currentIndex = items.findIndex((item) => item.id === itemId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= items.length) return;

    const previousItems = items;
    const nextItems = [...items];
    [nextItems[currentIndex], nextItems[nextIndex]] = [
      nextItems[nextIndex],
      nextItems[currentIndex],
    ];

    setItems(nextItems.map((item, index) => ({ ...item, sortOrder: index })));
    let errorMessage: string | null = null;
    try {
      const itemIds = nextItems.map((item) => item.id);
      const result = await runOnRow(itemId, () =>
        projectId
          ? reorderProjectInstructionItems({ projectId, itemIds })
          : reorderJobInstructionItems({ jobId: jobId!, itemIds })
      );
      if (result.success) {
        await syncItemsFromServer();
        return;
      }
      errorMessage = getErrorMessage(result.error);
    } catch {
      errorMessage = ERROR_MESSAGES.reorder_failed;
    }

    setItems(previousItems);
    await syncItemsFromServer();
    showErrorBanner(errorMessage);
  }

  const isReorderingDisabled = anyBusy || items.some((item) => item.isOptimistic);

  return (
    <>
      <div className="min-w-0 w-full overflow-hidden rounded-lg border bg-card p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <ClipboardList className="size-4" />
              Arbeitsanweisungen &amp; Notizen
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {isAdminOrManager
                ? 'Erfasse Anweisungen direkt als Checkliste. Mit Enter entsteht der nächste Punkt.'
                : readOnly
                  ? 'Die Arbeit ist abgeschlossen. Die Aufgaben bleiben als Verlauf sichtbar.'
                  : 'Du kannst die Punkte lesen und als erledigt oder offen markieren.'}
            </p>
          </div>
        </div>

        {!isAdminOrManager && items.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/20 px-4 py-6 text-center">
            <p className="text-sm font-medium">Noch keine Arbeitsanweisungen vorhanden.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sobald im Büro oder von einem Admin Punkte angelegt werden, erscheinen sie hier.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayedItems.map((entry) => {
              if (entry.type === 'draft') {
                return (
                  <div
                    key={entry.draft.draftId}
                    className="min-w-0 w-full rounded-md border border-dashed bg-muted/15 px-3 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="size-5 shrink-0 self-center rounded-full border border-muted-foreground/40 bg-background" />
                      <Textarea
                        ref={draftTextareaRef}
                        value={entry.draft.content}
                        onChange={(event) => {
                          resizeTextareaElement(event.currentTarget);
                          setDraft((currentDraft) =>
                            currentDraft
                              ? { ...currentDraft, content: event.target.value }
                              : currentDraft
                          );
                        }}
                        onBlur={() => {
                          if (!entry.draft.content.trim() && items.length > 0) {
                            setDraft({
                              draftId: generateDraftId(),
                              content: '',
                            });
                          }
                        }}
                        onKeyDown={async (event) => {
                          if (event.key !== 'Enter') return;

                          event.preventDefault();
                          if (event.shiftKey) return;
                          await handleCreateDraft(true);
                        }}
                        placeholder="Neuen Punkt eingeben..."
                        aria-label="Neuen Arbeitsanweisungs-Punkt eingeben"
                        className="field-sizing-fixed min-h-0 min-w-0 w-full max-w-full resize-none overflow-hidden border-0 !bg-transparent px-0 py-1 whitespace-pre-wrap break-words shadow-none focus-visible:ring-0 dark:!bg-transparent"
                      />
                    </div>
                  </div>
                );
              }

              const item = entry.item;
              const itemIndex = items.findIndex((currentItem) => currentItem.id === item.id);
              const editingValue = editingValues[item.id] ?? item.content;
              const isRowBusy = isBusy(item.id);
              const creatorLabel = `Erstellt von ${getActorName(item.creator)} · ${formatDateTime(item.createdAt)}`;
              const statusLabel = item.lastStatusChangedAt
                ? `Zuletzt ${item.isCompleted ? 'erledigt' : 'offen'} von ${getActorName(item.lastStatusChangedByProfile)} · ${formatDateTime(item.lastStatusChangedAt)}`
                : null;

              return (
                <div
                  key={item.id}
                  data-testid="job-instruction-item"
                  className={cn(
                    'min-w-0 w-full rounded-md border px-3 py-3 transition-colors',
                    item.isCompleted && 'border-orange-200 bg-orange-50/50 dark:border-orange-900/40 dark:bg-orange-950/10',
                    item.isOptimistic && 'opacity-80'
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (!readOnly) void handleToggleItem(item);
                      }}
                      disabled={readOnly || isRowBusy}
                      aria-busy={isRowBusy}
                      aria-label={
                        readOnly
                          ? item.isCompleted ? 'Punkt erledigt' : 'Punkt offen'
                          : item.isCompleted
                            ? 'Punkt als offen markieren'
                            : 'Punkt als erledigt markieren'
                      }
                      className={cn(
                        'mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-full border transition-colors sm:size-8',
                        readOnly && 'cursor-default opacity-70',
                        item.isCompleted
                          ? 'border-orange-500 bg-orange-500 text-white'
                          : 'border-muted-foreground/40 bg-background text-transparent'
                      )}
                    >
                      <Check className="size-3" />
                    </button>

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
                            if (event.key !== 'Enter') return;

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
                        <p className="py-1 text-sm leading-6 whitespace-pre-wrap break-words">
                          {item.content}
                        </p>
                      )}

                      <div className="mt-2 flex items-end justify-between gap-3 text-xs text-muted-foreground">
                        <div className="min-w-0 flex-1">
                          <p className="break-words">{creatorLabel}</p>
                          {statusLabel && <p className="mt-1 break-words">{statusLabel}</p>}
                        </div>
                        <InlinePending active={isRowBusy} className="self-center" />
                        {isAdminOrManager && (
                          <div className="flex shrink-0 self-end gap-0.5">
                            <Button type="button" variant="ghost" size="icon" className="size-7 text-muted-foreground" onPointerDown={(event) => event.preventDefault()} onClick={() => setDetailsItem(item)} aria-label="Eintragsdetails bearbeiten"><Settings2 className="size-3.5" /></Button>
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
                              disabled={
                                itemIndex === items.length - 1 ||
                                isReorderingDisabled
                              }
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
                        )}
                      </div>
                      {(item.groupLabel || item.requirementState === 'optional' || item.predecessors.length > 0 || item.evidenceRequirements.length > 0) && (
                        <div className="mt-2 space-y-1 rounded-md bg-muted/35 px-2.5 py-2 text-xs text-muted-foreground">
                          <p>{[item.groupLabel, item.itemKind === 'task' ? 'Aufgabe' : 'Checkliste', item.requirementState === 'optional' ? 'Optional' : 'Erforderlich'].filter(Boolean).join(' · ')}</p>
                          {item.predecessors.length > 0 && <p>Voraussetzung: {item.predecessors.map((entry) => entry.content).join(', ')}</p>}
                          {item.evidenceRequirements.map((evidence) => <p key={evidence.id}>{evidence.fulfillment ? 'Nachweis erfüllt' : 'Nachweis erwartet'}: {evidence.description}</p>)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <InstructionItemDetailsDialog
        key={detailsItem?.id ?? 'closed'}
        item={detailsItem}
        allItems={items}
        onClose={() => setDetailsItem(null)}
        onSaved={(item) => { replaceItem(item); setDetailsItem(null); showBanner({ variant: 'success', message: 'Eintragsdetails gespeichert.' }); }}
      />
    </>
  );
}

function InstructionItemDetailsDialog({ item, allItems, onClose, onSaved }: { item: JobInstructionItemWithDetails | null; allItems: JobInstructionItemWithDetails[]; onClose: () => void; onSaved: (item: JobInstructionItemWithDetails) => void }) {
  const [itemKind, setItemKind] = useState(item?.itemKind ?? 'checklist');
  const [requirementState, setRequirementState] = useState(item?.requirementState ?? 'required');
  const [groupLabel, setGroupLabel] = useState(item?.groupLabel ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [predecessorIds, setPredecessorIds] = useState(item?.predecessors.map((entry) => entry.id) ?? []);
  const [evidence, setEvidence] = useState(item?.evidenceRequirements.map((entry, index) => ({ ...entry, sortOrder: index })) ?? []);
  const [error, setError] = useState<string | null>(null);
  const { run: runSaveDetails, isPending } = useServerAction(updateInstructionItemDetails);
  if (!item) return null;
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(null);
    try {
      const result = await runSaveDetails({ itemId: item!.id, itemKind, requirementState, groupLabel, notes, evidence, predecessorItemIds: predecessorIds });
      if (!result.success) { setError(result.error === 'instruction_dependency_cycle' ? 'Abhängigkeiten dürfen keinen Kreis bilden.' : 'Die Eintragsdetails konnten nicht gespeichert werden.'); return; }
      onSaved(result.item);
    } catch {
      setError('Die Eintragsdetails konnten nicht gespeichert werden.');
    }
  }
  return <Dialog open onOpenChange={(open) => !open && !isPending && onClose()}><DialogContent className="sm:max-w-xl"><form onSubmit={save} className="contents"><DialogHeader><DialogTitle>Eintragsdetails bearbeiten</DialogTitle><DialogDescription>Die Angaben gehören zu diesem Auftrag oder Projekt und ändern die Vorlage nicht.</DialogDescription></DialogHeader><DialogBody className="space-y-4 py-1"><div className="grid gap-3 sm:grid-cols-2"><Field label="Art" htmlFor="instruction-kind"><Select value={itemKind} onValueChange={(value) => setItemKind(value as typeof itemKind)}><SelectTrigger id="instruction-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="task">Aufgabe</SelectItem><SelectItem value="checklist">Checkliste</SelectItem></SelectContent></Select></Field><Field label="Verbindlichkeit" htmlFor="instruction-requirement"><Select value={requirementState} onValueChange={(value) => setRequirementState(value as typeof requirementState)}><SelectTrigger id="instruction-requirement"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="required">Erforderlich</SelectItem><SelectItem value="optional">Optional</SelectItem></SelectContent></Select></Field></div><Field label="Gruppe" htmlFor="instruction-group"><Input value={groupLabel} onChange={(event) => setGroupLabel(event.target.value)} /></Field><Field label="Voraussetzungen"><SearchableMultiSelect ariaLabel="Voraussetzungen" options={allItems.filter((entry) => entry.id !== item.id).map((entry) => ({ value: entry.id, label: entry.content }))} selectedIds={predecessorIds} onSelectionChange={setPredecessorIds} placeholder="Keine Voraussetzungen" searchPlaceholder="Eintrag suchen…" emptyMessage="Kein anderer Eintrag" /></Field><Field label="Hinweise" htmlFor="instruction-notes"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></Field><div className="space-y-2"><div className="flex items-center justify-between"><Label>Erwartete Nachweise</Label><Button type="button" variant="ghost" size="sm" onClick={() => setEvidence((current) => [...current, { id: generateDraftId(), description: '', documentCategory: 'photo', sortOrder: current.length }])}>Nachweis ergänzen</Button></div>{evidence.map((entry) => <div key={entry.id} className="grid gap-2 sm:grid-cols-[1fr_140px_auto]"><Input aria-label="Nachweisbeschreibung" value={entry.description} onChange={(event) => setEvidence((current) => current.map((value) => value.id === entry.id ? { ...value, description: event.target.value } : value))} /><Select value={entry.documentCategory} onValueChange={(value) => setEvidence((current) => current.map((currentEntry) => currentEntry.id === entry.id ? { ...currentEntry, documentCategory: value } : currentEntry))}><SelectTrigger aria-label="Nachweiskategorie"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="photo">Foto</SelectItem><SelectItem value="report">Bericht</SelectItem><SelectItem value="contract">Vertrag</SelectItem><SelectItem value="offer">Angebot</SelectItem><SelectItem value="invoice">Rechnung</SelectItem><SelectItem value="other">Sonstiges</SelectItem></SelectContent></Select><Button type="button" size="icon" variant="ghost" aria-label="Nachweis entfernen" onClick={() => setEvidence((current) => current.filter((value) => value.id !== entry.id))}><Trash2 className="size-4" /></Button></div>)}</div><ErrorText>{error}</ErrorText></DialogBody><DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Abbrechen</Button><Button type="submit" disabled={isPending}>{isPending && <Loader2 className="size-4 animate-spin" />}Speichern</Button></DialogFooter></form></DialogContent></Dialog>;
}
