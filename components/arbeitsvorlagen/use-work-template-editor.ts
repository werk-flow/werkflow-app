'use client';

import { useState } from 'react';

import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import type { ActionFailure } from '@/lib/action-result';
import type { CapabilityDefinition } from '@/lib/qualifications/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import {
  createNextWorkTemplateDraft,
  publishWorkTemplate,
  saveWorkTemplateDraft,
} from '@/lib/work-templates/actions';
import type { WorkTemplateDetail, WorkTemplateDraft } from '@/lib/work-templates/types';

import { useWorkTemplateEditorOptions } from './use-work-template-editor-options';
import { ERROR_MESSAGES, withWorkTemplateSortOrders } from './work-template-editor-shared';

type WorkTemplateEditorInput = {
  detail: WorkTemplateDetail | null;
  capabilities: CapabilityDefinition[];
  onOpenChange: (open: boolean) => void;
  onChanged: (message: string) => Promise<void>;
};

const SAVE_FAILED = 'Der Entwurf konnte nicht gespeichert werden.';
const PUBLISH_FAILED = 'Die Version konnte nicht veröffentlicht werden.';

/** The sentence for a failed or unreachable editor request. */
function editorFailureMessage(result: ActionFailure | null, fallback: string): string {
  return result ? describeFailure(result.error, ERROR_MESSAGES, fallback) : fallback;
}

/** Saves the draft with its on-screen order; the sentence on failure, otherwise null. */
async function saveDraftFailure(templateId: string, draft: WorkTemplateDraft): Promise<string | null> {
  const result = await saveWorkTemplateDraft({
    templateId,
    draft: withWorkTemplateSortOrders(draft),
  }).catch(() => null);
  return result?.success ? null : editorFailureMessage(result, SAVE_FAILED);
}

/** The editor's draft, its feedback and the pending state of each footer button. */
function useWorkTemplateEditorState({
  detail,
  capabilities,
  onOpenChange,
}: Pick<WorkTemplateEditorInput, 'detail' | 'capabilities' | 'onOpenChange'>) {
  const [draft, setDraft] = useState<WorkTemplateDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  // One gate per footer button so the spinner sits on the button that was pressed.
  const { run: runSave, isPending: isSaving } = usePendingTask();
  const { run: runPublish, isPending: isPublishing } = usePendingTask();
  const { run: runNextDraft, isPending: isCreatingNextDraft } = usePendingTask();
  const options = useWorkTemplateEditorOptions({ detail, draft, setDraft, capabilities });

  function update(next: WorkTemplateDraft) {
    setDraft(next);
    setError(null);
    if (next.name.trim()) setNameError(null);
  }
  function close(open: boolean) {
    if (!open) {
      setDraft(null);
      options.resetResolvedOptionIds();
      setError(null);
      setNameError(null);
    }
    onOpenChange(open);
  }
  // The name is the one required field; a missing name is marked before any request.
  function hasInvalidName(): boolean {
    const message = options.activeDraft?.name.trim() ? undefined : 'Bitte gib einen Namen ein.';
    setNameError(message ?? null);
    return focusFirstInvalidField({ 'template-name': message });
  }

  return {
    ...options,
    draft,
    error,
    setError,
    nameError,
    runSave,
    isSaving,
    runPublish,
    isPublishing,
    runNextDraft,
    isCreatingNextDraft,
    isPending: isSaving || isPublishing || isCreatingNextDraft,
    editable: Boolean(detail?.draftVersionId),
    update,
    close,
    hasInvalidName,
  };
}

/** The template editor's state and its save, publish and next-version commands. */
export function useWorkTemplateEditor({
  detail,
  capabilities,
  onOpenChange,
  onChanged,
}: WorkTemplateEditorInput) {
  const state = useWorkTemplateEditorState({ detail, capabilities, onOpenChange });
  const { draft, activeDraft, setError, hasInvalidName, close } = state;

  function save() {
    if (!detail || !activeDraft) return;
    if (hasInvalidName()) return;
    void state.runSave(async () => {
      const failure = await saveDraftFailure(detail.id, activeDraft);
      if (failure) {
        setError(failure);
        return;
      }
      await onChanged('Entwurf gespeichert.');
    });
  }
  function publish() {
    if (!detail) return;
    if (hasInvalidName()) return;
    void state.runPublish(async () => {
      if (draft && activeDraft) {
        const saveFailure = await saveDraftFailure(detail.id, activeDraft);
        if (saveFailure) {
          setError(saveFailure);
          return;
        }
      }
      const result = await publishWorkTemplate(detail.id).catch(() => null);
      if (!result?.success) {
        setError(editorFailureMessage(result, PUBLISH_FAILED));
        return;
      }
      close(false);
      await onChanged(`Version ${detail.versionNumber} wurde veröffentlicht.`);
    });
  }
  function createNextDraft() {
    if (!detail) return;
    void state.runNextDraft(async () => {
      const result = await createNextWorkTemplateDraft(detail.id).catch(() => null);
      if (!result?.success) {
        setError('Die nächste Version konnte nicht angelegt werden.');
        return;
      }
      close(false);
      await onChanged('Ein neuer Entwurf wurde angelegt.');
    });
  }

  return { ...state, save, publish, createNextDraft };
}
