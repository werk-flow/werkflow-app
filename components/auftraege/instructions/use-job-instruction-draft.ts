'use client';

import { useEffect, useRef, useState } from 'react';

import type { useBusyIds } from '@/hooks/use-busy-id';
import { createJobInstructionItem, createProjectInstructionItem } from '@/lib/jobs/instruction-items-actions';
import type { InstructionListOwner, JobInstructionActor } from '@/lib/jobs/types';
import { generateDraftId } from './job-instruction-draft-id';
import { ERROR_MESSAGES, getJobInstructionErrorMessage } from './job-instruction-errors';
import { resizeTextareaElement } from './job-instruction-textarea';
import type { JobInstructionItemList, RenderedInstructionItem } from './use-job-instruction-item-list';

type DraftInstructionItem = {
  draftId: string;
  content: string;
};

type JobInstructionDraftOptions = {
  owner: InstructionListOwner;
  isAdminOrManager: boolean;
  currentUserActor: JobInstructionActor | null;
  itemList: JobInstructionItemList;
  runOnRow: ReturnType<typeof useBusyIds>['run'];
  showErrorBanner: (message: string) => void;
};

/** The always-present empty draft row of a manager and its optimistic create. */
export function useJobInstructionDraft({
  owner,
  isAdminOrManager,
  currentUserActor,
  itemList,
  runOnRow,
  showErrorBanner,
}: JobInstructionDraftOptions) {
  const { items, setItems, appendItem, syncItemsFromServer } = itemList;
  const [draft, setDraft] = useState<DraftInstructionItem | null>(
    isAdminOrManager
      ? {
          draftId: generateDraftId(),
          content: '',
        }
      : null,
  );
  const [focusedDraftId, setFocusedDraftId] = useState<string | null>(null);
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // A viewer who is no manager has no draft row; a manager always has exactly
  // one. The row follows the role during render: an effect keyed on the rows
  // re-ran on every rebased render of the list and kept the page committing.
  const [draftRoleIsManager, setDraftRoleIsManager] = useState(isAdminOrManager);
  if (isAdminOrManager !== draftRoleIsManager) {
    setDraftRoleIsManager(isAdminOrManager);
    setDraft(isAdminOrManager ? { draftId: generateDraftId(), content: '' } : null);
  }

  useEffect(() => {
    if (focusedDraftId && draft?.draftId === focusedDraftId) {
      draftTextareaRef.current?.focus();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the focus request is consumed once the requested draft row is mounted
      setFocusedDraftId(null);
    }
  }, [draft, focusedDraftId]);

  useEffect(() => {
    resizeTextareaElement(draftTextareaRef.current);
  }, [draft?.content]);

  function focusDraft() {
    if (!draft) return;
    setFocusedDraftId(draft.draftId);
  }

  async function handleCreateDraft() {
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
      jobId: owner.jobId ?? null,
      projectId: owner.projectId ?? null,
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
    setDraft({
      draftId: nextDraftId,
      content: '',
    });
    setFocusedDraftId(nextDraftId);

    let errorMessage: string | null = null;
    try {
      const result = await runOnRow(optimisticId, () =>
        owner.projectId !== undefined
          ? createProjectInstructionItem({ projectId: owner.projectId, content: draftSnapshot.content })
          : createJobInstructionItem({ jobId: owner.jobId, content: draftSnapshot.content }),
      );
      if (result.success) {
        // A sync during the create may already have brought the saved row.
        setItems((currentItems) =>
          currentItems.some((item) => item.id === result.item.id)
            ? currentItems.filter((item) => item.id !== optimisticId)
            : currentItems.map((item) => (item.id === optimisticId ? result.item : item)),
        );
        return;
      }
      errorMessage = getJobInstructionErrorMessage(result.error);
    } catch {
      errorMessage = ERROR_MESSAGES.create_failed;
    }

    // Roll the optimistic row back and hand the typed text back to the draft,
    // ahead of anything typed into the new draft while the create was pending.
    setItems((currentItems) => currentItems.filter((item) => item.id !== optimisticId));
    setDraft((currentDraft) => {
      const typedMeanwhile = currentDraft?.content.trim() ? currentDraft.content : '';
      return {
        draftId: generateDraftId(),
        content: typedMeanwhile ? `${draftSnapshot.content}\n${typedMeanwhile}` : draftSnapshot.content,
      };
    });
    showErrorBanner(errorMessage);
    await syncItemsFromServer();
  }

  return { draft, setDraft, draftTextareaRef, focusDraft, handleCreateDraft };
}
