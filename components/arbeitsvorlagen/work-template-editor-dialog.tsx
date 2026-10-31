'use client';

import type { ReactElement } from 'react';
import { History, Plus, Save, Send } from 'lucide-react';

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
import type { InventoryLocation } from '@/lib/inventory/types';
import type { CapabilityDefinition } from '@/lib/qualifications/types';
import { formatBerlinDateTime } from '@/lib/utils';
import type { WorkTemplateDetail, WorkTemplateDraft } from '@/lib/work-templates/types';

import { useWorkTemplateEditor } from './use-work-template-editor';
import { CapabilitiesEditor } from './work-template-capabilities-editor';
import { ItemsEditor } from './work-template-items-editor';
import { MaterialsEditor } from './work-template-materials-editor';

export function TemplateEditorDialog({
  detail,
  onOpenChange,
  inventoryLocations,
  capabilities,
  onChanged,
}: {
  detail: WorkTemplateDetail | null;
  onOpenChange: (open: boolean) => void;
  inventoryLocations: InventoryLocation[];
  capabilities: CapabilityDefinition[];
  onChanged: (message: string) => Promise<void>;
}): ReactElement {
  const editor = useWorkTemplateEditor({ detail, capabilities, onOpenChange, onChanged });
  const { activeDraft, editable, isPending, update, close } = editor;
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
            editor.save();
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
            <WorkTemplateDraftEditors
              draft={activeDraft}
              editable={editable}
              nameError={editor.nameError}
              onChange={update}
              editor={editor}
              inventoryLocations={inventoryLocations}
            />
            <WorkTemplateHistorySection history={detail.history} />
            <ErrorText>{editor.error}</ErrorText>
          </DialogBody>
          <TemplateEditorFooter
            editable={editable}
            isPending={isPending}
            isSaving={editor.isSaving}
            isPublishing={editor.isPublishing}
            isCreatingNextDraft={editor.isCreatingNextDraft}
            isOptionPending={editor.optionBusy.anyBusy}
            onClose={() => close(false)}
            onPublish={editor.publish}
            onCreateNextDraft={editor.createNextDraft}
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

function WorkTemplateDraftEditors({
  draft,
  editable,
  nameError,
  onChange,
  editor,
  inventoryLocations,
}: {
  draft: WorkTemplateDraft;
  editable: boolean;
  nameError: string | null;
  onChange: (draft: WorkTemplateDraft) => void;
  editor: Pick<
    ReturnType<typeof useWorkTemplateEditor>,
    | 'patchDraft'
    | 'createdInventoryItems'
    | 'createInventoryItem'
    | 'capabilityItemOptions'
    | 'createCapabilityOption'
    | 'optionBusy'
  >;
  inventoryLocations: InventoryLocation[];
}) {
  return (
    <>
      <WorkTemplateBasicsSection
        draft={draft}
        editable={editable}
        nameError={nameError}
        onChange={onChange}
      />
      <ItemsEditor draft={draft} editable={editable} onChange={onChange} />
      <MaterialsEditor
        draft={draft}
        editable={editable}
        onChange={onChange}
        onPatch={editor.patchDraft}
        createdItems={editor.createdInventoryItems}
        inventoryLocations={inventoryLocations}
        onCreateItem={editor.createInventoryItem}
        isItemPending={editor.optionBusy.isBusy}
      />
      <CapabilitiesEditor
        draft={draft}
        editable={editable}
        onChange={onChange}
        capabilities={editor.capabilityItemOptions}
        onCreateCapability={editor.createCapabilityOption}
        isCapabilityPending={editor.optionBusy.isBusy}
      />
    </>
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
          <Button pending={isSaving} type="submit" variant="outline" disabled={isPending || isOptionPending}>
            <Save className="size-4" />
            Speichern
          </Button>
          <Button
            pending={isPublishing}
            type="button"
            onClick={onPublish}
            disabled={isPending || isOptionPending}
          >
            <Send className="size-4" />
            Veröffentlichen
          </Button>
        </>
      ) : (
        <Button pending={isCreatingNextDraft} type="button" onClick={onCreateNextDraft} disabled={isPending}>
          <Plus className="size-4" />
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
          <span className="min-w-0 break-words">
            {HISTORY_EVENT_LABELS[event.eventType] ?? 'Geändert'}{' '}
            {event.versionNumber ? `· Version ${event.versionNumber}` : ''}
            {event.targetLabel && <span className="block">{event.targetLabel}</span>}
            <span className="block text-muted-foreground">{event.actorName}</span>
          </span>
          <time className="shrink-0 text-muted-foreground">{formatBerlinDateTime(event.createdAt)}</time>
        </div>
      ))}
    </section>
  );
}
