'use client';

import { useState, type ReactElement } from 'react';
import { History, Loader2, Plus, Save, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { usePendingTask } from '@/hooks/use-server-action';
import type { InventoryLocation, InventoryPickerOption } from '@/lib/inventory/types';
import type { CapabilityDefinition } from '@/lib/qualifications/types';
import { formatBerlinDateTime } from '@/lib/utils';
import {
  createNextWorkTemplateDraft,
  publishWorkTemplate,
  saveWorkTemplateDraft,
} from '@/lib/work-templates/actions';
import type { WorkTemplateDetail, WorkTemplateDraft } from '@/lib/work-templates/types';
import { describeFailure } from '@/lib/action-messages';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

import { useWorkTemplateEditorOptions } from './use-work-template-editor-options';
import { CapabilitiesEditor } from './work-template-capabilities-editor';
import { ERROR_MESSAGES, withWorkTemplateSortOrders } from './work-template-editor-shared';
import { ItemsEditor } from './work-template-items-editor';
import { MaterialsEditor } from './work-template-materials-editor';

export function TemplateEditorDialog({
  detail,
  onOpenChange,
  inventoryItems,
  inventoryLocations,
  capabilities,
  onChanged,
}: {
  detail: WorkTemplateDetail | null;
  onOpenChange: (open: boolean) => void;
  inventoryItems: InventoryPickerOption[];
  inventoryLocations: InventoryLocation[];
  capabilities: CapabilityDefinition[];
  onChanged: (message: string) => Promise<void>;
}): ReactElement {
  const [draft, setDraft] = useState<WorkTemplateDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  // One gate per footer button so the spinner sits on the button that was pressed.
  const { run: runSave, isPending: isSaving } = usePendingTask();
  const { run: runPublish, isPending: isPublishing } = usePendingTask();
  const { run: runNextDraft, isPending: isCreatingNextDraft } = usePendingTask();
  const isPending = isSaving || isPublishing || isCreatingNextDraft;
  const {
    activeDraft,
    inventoryItemOptions,
    capabilityItemOptions,
    optionBusy,
    patchDraft,
    resetResolvedOptionIds,
    createInventoryItem,
    createCapabilityOption,
  } = useWorkTemplateEditorOptions({ detail, draft, setDraft, inventoryItems, capabilities });
  const editable = Boolean(detail?.draftVersionId);

  function update(next: WorkTemplateDraft) {
    setDraft(next);
    setError(null);
    if (next.name.trim()) setNameError(null);
  }
  function close(open: boolean) {
    if (!open) {
      setDraft(null);
      resetResolvedOptionIds();
      setError(null);
      setNameError(null);
    }
    onOpenChange(open);
  }
  // The name is the one required field; a missing name is marked before any request.
  function hasInvalidName(): boolean {
    const message = activeDraft?.name.trim() ? undefined : 'Bitte gib einen Namen ein.';
    setNameError(message ?? null);
    return focusFirstInvalidField({ 'template-name': message });
  }
  function save() {
    if (!detail || !activeDraft) return;
    if (hasInvalidName()) return;
    void runSave(async () => {
      const result = await saveWorkTemplateDraft({
        templateId: detail.id,
        draft: withWorkTemplateSortOrders(activeDraft),
      }).catch(() => null);
      if (!result?.success) {
        setError(
          result
            ? describeFailure(result.error, ERROR_MESSAGES, 'Der Entwurf konnte nicht gespeichert werden.')
            : 'Der Entwurf konnte nicht gespeichert werden.',
        );
        return;
      }
      await onChanged('Entwurf gespeichert.');
    });
  }
  function publish() {
    if (!detail) return;
    if (hasInvalidName()) return;
    void runPublish(async () => {
      if (draft && activeDraft) {
        const saveResult = await saveWorkTemplateDraft({
          templateId: detail.id,
          draft: withWorkTemplateSortOrders(activeDraft),
        }).catch(() => null);
        if (!saveResult?.success) {
          setError(
            saveResult
              ? describeFailure(
                  saveResult.error,
                  ERROR_MESSAGES,
                  'Der Entwurf konnte nicht gespeichert werden.',
                )
              : 'Der Entwurf konnte nicht gespeichert werden.',
          );
          return;
        }
      }
      const result = await publishWorkTemplate(detail.id).catch(() => null);
      if (!result?.success) {
        setError(
          result
            ? describeFailure(result.error, ERROR_MESSAGES, 'Die Version konnte nicht veröffentlicht werden.')
            : 'Die Version konnte nicht veröffentlicht werden.',
        );
        return;
      }
      close(false);
      await onChanged(`Version ${detail.versionNumber} wurde veröffentlicht.`);
    });
  }
  function createNextDraft() {
    if (!detail) return;
    void runNextDraft(async () => {
      const result = await createNextWorkTemplateDraft(detail.id).catch(() => null);
      if (!result?.success) {
        setError('Die nächste Version konnte nicht angelegt werden.');
        return;
      }
      close(false);
      await onChanged('Ein neuer Entwurf wurde angelegt.');
    });
  }
  if (!detail || !activeDraft)
    return (
      <Dialog open={false}>
        <DialogContent>
          <DialogTitle>Arbeitsvorlage</DialogTitle>
        </DialogContent>
      </Dialog>
    );

  return (
    <Dialog open onOpenChange={close} pending={isPending}>
      <DialogContent size="4xl">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          className="contents"
        >
          <DialogHeader>
            <DialogTitle>
              {editable
                ? `Entwurf · Version ${detail.versionNumber}`
                : `${detail.name} · Version ${detail.versionNumber}`}
            </DialogTitle>
            <DialogDescription>
              {editable
                ? 'Nach dem Veröffentlichen bleibt diese Version unveränderlich.'
                : 'Diese veröffentlichte Version ist unveränderlich. Für Änderungen legst du eine neue Version an.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-6 py-1">
            <WorkTemplateBasicsSection
              draft={activeDraft}
              editable={editable}
              nameError={nameError}
              onChange={update}
            />
            <ItemsEditor draft={activeDraft} editable={editable} onChange={update} />
            <MaterialsEditor
              draft={activeDraft}
              editable={editable}
              onChange={update}
              onPatch={patchDraft}
              inventoryItems={inventoryItemOptions}
              inventoryLocations={inventoryLocations}
              onCreateItem={createInventoryItem}
              isItemPending={optionBusy.isBusy}
            />
            <CapabilitiesEditor
              draft={activeDraft}
              editable={editable}
              onChange={update}
              capabilities={capabilityItemOptions}
              onCreateCapability={createCapabilityOption}
              isCapabilityPending={optionBusy.isBusy}
            />
            <WorkTemplateHistorySection history={detail.history} />
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <TemplateEditorFooter
            editable={editable}
            isPending={isPending}
            isSaving={isSaving}
            isPublishing={isPublishing}
            isCreatingNextDraft={isCreatingNextDraft}
            isOptionPending={optionBusy.anyBusy}
            onClose={() => close(false)}
            onPublish={publish}
            onCreateNextDraft={createNextDraft}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WorkTemplateBasicsSection({
  draft,
  editable,
  nameError,
  onChange,
}: {
  draft: WorkTemplateDraft;
  editable: boolean;
  nameError: string | null;
  onChange: (draft: WorkTemplateDraft) => void;
}) {
  return (
    <section className="space-y-4">
      <h3 className="font-semibold">Grunddaten</h3>
      <Field label="Name" htmlFor="template-name" required error={nameError}>
        <Input
          value={draft.name}
          disabled={!editable}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </Field>
      <Field label="Beschreibung" htmlFor="template-description">
        <Textarea
          value={draft.description ?? ''}
          disabled={!editable}
          onChange={(event) => onChange({ ...draft, description: event.target.value || null })}
        />
      </Field>
    </section>
  );
}

function TemplateEditorFooter({
  editable,
  isPending,
  isSaving,
  isPublishing,
  isCreatingNextDraft,
  isOptionPending,
  onClose,
  onPublish,
  onCreateNextDraft,
}: {
  editable: boolean;
  isPending: boolean;
  isSaving: boolean;
  isPublishing: boolean;
  isCreatingNextDraft: boolean;
  isOptionPending: boolean;
  onClose: () => void;
  onPublish: () => void;
  onCreateNextDraft: () => void;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
        Schließen
      </Button>
      {editable ? (
        <>
          <Button type="submit" variant="outline" disabled={isPending || isOptionPending}>
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Speichern
          </Button>
          <Button type="button" onClick={onPublish} disabled={isPending || isOptionPending}>
            {isPublishing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Veröffentlichen
          </Button>
        </>
      ) : (
        <Button type="button" onClick={onCreateNextDraft} disabled={isPending}>
          {isCreatingNextDraft ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Neue Version
        </Button>
      )}
    </DialogFooter>
  );
}

// Mirrors the event_type check on work_template_events.
const HISTORY_EVENT_LABELS: Readonly<Record<string, string>> = {
  created: 'Angelegt',
  draft_saved: 'Entwurf gespeichert',
  published: 'Veröffentlicht',
  draft_created: 'Neuer Entwurf',
  archived: 'Archiviert',
  reactivated: 'Reaktiviert',
  applied: 'Angewendet',
};

function WorkTemplateHistorySection({ history }: { history: WorkTemplateDetail['history'] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <History className="size-4" />
        <h3 className="font-semibold">Verlauf</h3>
      </div>
      {history.map((event) => (
        <div key={event.id} className="flex justify-between gap-3 border-b pb-2 text-sm">
          <span>
            {HISTORY_EVENT_LABELS[event.eventType] ?? 'Geändert'}{' '}
            {event.versionNumber ? `· Version ${event.versionNumber}` : ''}
            {event.targetLabel && <span className="block">{event.targetLabel}</span>}
            <span className="block text-muted-foreground">{event.actorName}</span>
          </span>
          <time className="text-muted-foreground">{formatBerlinDateTime(event.createdAt)}</time>
        </div>
      ))}
    </section>
  );
}
