'use client';

import { Textarea } from '@/components/ui/textarea';
import { generateDraftId } from './job-instruction-draft-id';
import { resizeTextareaElement } from './job-instruction-textarea';
import type { useJobInstructionDraft } from './use-job-instruction-draft';
import type { RenderedInstructionItem } from './use-job-instruction-item-list';

type JobInstructionDraftState = ReturnType<typeof useJobInstructionDraft>;

type JobInstructionDraftRowProps = Pick<
  JobInstructionDraftState,
  'setDraft' | 'draftTextareaRef' | 'handleCreateDraft'
> & {
  draft: NonNullable<JobInstructionDraftState['draft']>;
  items: RenderedInstructionItem[];
};

export function JobInstructionDraftRow({
  draft,
  items,
  setDraft,
  draftTextareaRef,
  handleCreateDraft,
}: JobInstructionDraftRowProps) {
  return (
    <div className="min-w-0 w-full rounded-md border border-dashed bg-muted/15 px-3 py-3">
      <div className="flex items-center gap-3">
        <span className="size-5 shrink-0 self-center rounded-full border border-muted-foreground/40 bg-background" />
        <Textarea
          ref={draftTextareaRef}
          value={draft.content}
          onChange={(event) => {
            resizeTextareaElement(event.currentTarget);
            setDraft((currentDraft) =>
              currentDraft ? { ...currentDraft, content: event.target.value } : currentDraft,
            );
          }}
          onBlur={() => {
            if (!draft.content.trim() && items.length > 0) {
              setDraft({
                draftId: generateDraftId(),
                content: '',
              });
            }
          }}
          onKeyDown={async (event) => {
            // Enter that confirms an IME composition is not a create.
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;

            event.preventDefault();
            if (event.shiftKey) return;
            await handleCreateDraft();
          }}
          placeholder="Neuen Punkt eingeben…"
          aria-label="Neuen Arbeitsanweisungs-Punkt eingeben"
          className="field-sizing-fixed min-h-0 min-w-0 w-full max-w-full resize-none overflow-hidden border-0 !bg-transparent px-0 py-1 whitespace-pre-wrap break-words shadow-none focus-visible:ring-0 dark:!bg-transparent"
        />
      </div>
    </div>
  );
}
