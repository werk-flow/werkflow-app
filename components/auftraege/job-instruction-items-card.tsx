'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ClipboardList, Loader2, Trash2 } from 'lucide-react';

import {
  ActionBanner,
  type ActionBannerState,
} from '@/components/kalender/day-view/undo-banner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  createJobInstructionItem,
  deleteJobInstructionItem,
  getJobInstructionItems,
  toggleJobInstructionItemCompletion,
  updateJobInstructionItemContent,
} from '@/lib/jobs/instruction-items-actions';
import type {
  JobInstructionActor,
  JobInstructionItemWithDetails,
} from '@/lib/jobs/types';

type JobInstructionItemsCardProps = {
  jobId: string;
  initialItems: JobInstructionItemWithDetails[];
  isAdminOrManager: boolean;
  currentUserActor: JobInstructionActor | null;
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
  reorder_failed: 'Die Reihenfolge der Punkte konnte nicht gespeichert werden.',
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
  initialItems,
  isAdminOrManager,
  currentUserActor,
}: JobInstructionItemsCardProps) {
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
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [focusedDraftId, setFocusedDraftId] = useState<string | null>(null);
  const [activeBanner, setActiveBanner] = useState<ActionBannerState | null>(null);
  const bannerSequenceRef = useRef(0);
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const itemTextareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const toggleMutationSequenceRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

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
    bannerSequenceRef.current += 1;
    setActiveBanner({
      id: bannerSequenceRef.current,
      variant: 'error',
      message,
    });
  }

  async function syncItemsFromServer(): Promise<RenderedInstructionItem[]> {
    const result = await getJobInstructionItems(jobId);
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

  async function handleSaveExistingItem(item: JobInstructionItemWithDetails): Promise<boolean> {
    const nextValue = editingValues[item.id];
    if (nextValue === undefined || nextValue === item.content) {
      return true;
    }

    const trimmed = nextValue.trim();
    if (!trimmed) {
      setEditingValues((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      showErrorBanner(ERROR_MESSAGES.content_required);
      return false;
    }

    const result = await updateJobInstructionItemContent({
      itemId: item.id,
      content: nextValue,
    });

    if (!result.success) {
      await syncItemsFromServer();
      setEditingValues((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      showErrorBanner(getErrorMessage(result.error));
      return false;
    }

    replaceItem(result.item);
    setEditingValues((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });

    return true;
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
      jobId,
      content: draftSnapshot.content,
      sortOrder: items.length,
      isCompleted: false,
      createdBy: currentUserActor?.userId ?? '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastStatusChangedBy: null,
      lastStatusChangedAt: null,
      creator: currentUserActor,
      lastStatusChangedByProfile: null,
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

    const result = await createJobInstructionItem({
      jobId,
      content: draftSnapshot.content,
    });

    if (!result.success) {
      setItems((currentItems) =>
        currentItems.filter((item) => item.id !== optimisticId)
      );
      await syncItemsFromServer();
      setDraft({
        draftId: generateDraftId(),
        content: draftSnapshot.content,
      });
      showErrorBanner(getErrorMessage(result.error));
      return;
    }

    setItems((currentItems) =>
      currentItems.map((item) => (item.id === optimisticId ? result.item : item))
    );
  }

  async function handleToggleItem(item: JobInstructionItemWithDetails) {
    const optimisticTimestamp = new Date().toISOString();
    const nextSequence =
      (toggleMutationSequenceRef.current.get(item.id) ?? 0) + 1;
    toggleMutationSequenceRef.current.set(item.id, nextSequence);

    replaceItem({
      ...item,
      isCompleted: !item.isCompleted,
      lastStatusChangedAt: optimisticTimestamp,
      lastStatusChangedBy: currentUserActor?.userId ?? item.lastStatusChangedBy,
      lastStatusChangedByProfile:
        currentUserActor ?? item.lastStatusChangedByProfile,
      updatedAt: optimisticTimestamp,
    });

    const result = await toggleJobInstructionItemCompletion({
      itemId: item.id,
      isCompleted: !item.isCompleted,
    });

    if (toggleMutationSequenceRef.current.get(item.id) !== nextSequence) {
      return;
    }

    if (!result.success) {
      await syncItemsFromServer();
      showErrorBanner(getErrorMessage(result.error));
      return;
    }

    replaceItem(result.item);
  }

  async function handleDeleteItem(item: JobInstructionItemWithDetails) {
    setDeletingItemId(item.id);
    const result = await deleteJobInstructionItem({ itemId: item.id });
    setDeletingItemId(null);

    if (!result.success) {
      showErrorBanner(getErrorMessage(result.error));
      return;
    }

    const remainingItems = items.filter((entry) => entry.id !== item.id);
    setItems(remainingItems);
  }

  return (
    <>
      <ActionBanner banner={activeBanner} onDismiss={() => setActiveBanner(null)} />
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
              const editingValue = editingValues[item.id] ?? item.content;
              const isDeleting = deletingItemId === item.id;
              const creatorLabel = `Erstellt von ${getActorName(item.creator)} · ${formatDateTime(item.createdAt)}`;
              const statusLabel = item.lastStatusChangedAt
                ? `Zuletzt ${item.isCompleted ? 'erledigt' : 'offen'} von ${getActorName(item.lastStatusChangedByProfile)} · ${formatDateTime(item.lastStatusChangedAt)}`
                : null;

              return (
                <div
                  key={item.id}
                  className={cn(
                    'min-w-0 w-full rounded-md border px-3 py-3 transition-colors',
                    item.isCompleted && 'border-orange-200 bg-orange-50/50 dark:border-orange-900/40 dark:bg-orange-950/10',
                    item.isOptimistic && 'opacity-80'
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <button
                      type="button"
                      onClick={() => handleToggleItem(item)}
                      aria-label={
                        item.isCompleted
                          ? 'Punkt als offen markieren'
                          : 'Punkt als erledigt markieren'
                      }
                      className={cn(
                        'mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
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
                        {isAdminOrManager && (
                          <div className="flex shrink-0 self-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeleteItem(item)}
                              disabled={isDeleting}
                              aria-label="Punkt löschen"
                            >
                              {isDeleting ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="size-3.5" />
                              )}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
