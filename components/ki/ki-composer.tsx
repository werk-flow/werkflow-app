'use client';

import { ArrowUp, Square } from 'lucide-react';
import { memo, useState, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { AI_PRODUCT_NAME } from '@/lib/ai/name';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { readDraft, subscribeDrafts, writeDraft } from '@/lib/ai/chat-drafts';
import type { AiUploadedFile } from '@/lib/ai/files/types';
import { KiAttachButtons, KiAttachmentList, useKiUploads } from './ki-attachments';

// The composer stays mounted while the person switches threads (brief
// non-negotiable 8); its drafts live in lib/ai/chat-drafts.ts.

const COMPOSER_ID = 'ki-composer';

/** Enter sends on a keyboard with a mouse; on a phone it starts a new line. */
function sendsOnEnter(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  return (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    window.matchMedia('(pointer: fine)').matches
  );
}

/** The composer's refusals, each once, and that WerkFlow KI can be wrong. */
function ComposerNotes({ errors }: { errors: readonly (string | null)[] }): React.JSX.Element {
  return (
    <>
      {[...new Set(errors)].map((message) => message && <ErrorText key={message}>{message}</ErrorText>)}
      <p className="text-xs text-muted-foreground">
        {AI_PRODUCT_NAME} ist eine KI und kann sich irren. Prüf wichtige Angaben, bevor du sie verwendest.
      </p>
    </>
  );
}

/**
 * Send, or „Antwort anhalten“ while an answer is written. Two elements, not
 * one that changes its type: a click that stops the answer must not end as a
 * submit of the button it re-rendered into.
 */
function ComposerAction({
  running,
  stopping,
  onStop,
}: {
  running: boolean;
  stopping: boolean;
  onStop: () => void;
}): React.JSX.Element {
  return running ? (
    <Button
      key="stop"
      type="button"
      size="icon"
      variant="outline"
      className="size-11"
      pending={stopping}
      onClick={onStop}
    >
      <Square />
      <span className="sr-only">Antwort anhalten</span>
    </Button>
  ) : (
    <Button key="send" type="submit" size="icon" className="size-11">
      <ArrowUp />
      <span className="sr-only">Senden</span>
    </Button>
  );
}

export const KiComposer = memo(function KiComposer({
  organizationId,
  draft,
  running,
  stopping,
  error,
  onSend,
  onStop,
}: {
  organizationId: string;
  /** The sessionStorage key of the open thread's draft. */
  draft: string;
  /** An answer is being written: the composer offers to stop it instead of sending. */
  running: boolean;
  /** The person stopped the answer: the server ends it. */
  stopping: boolean;
  error: string | null;
  /** Sends the text and files of the draft under `draft`; the composer has already cleared it. */
  onSend: (text: string, draft: string, uploads: readonly AiUploadedFile[]) => void;
  onStop: () => void;
}): React.JSX.Element {
  const text = useSyncExternalStore(
    subscribeDrafts,
    () => readDraft(draft),
    () => '',
  );
  const [missing, setMissing] = useState(false);
  const files = useKiUploads(organizationId, draft);

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    // While an answer runs, the composer only keeps the draft; stopping is its own button.
    if (running) return;
    if (!text.trim()) {
      setMissing(true);
      focusFirstInvalidField({ [COMPOSER_ID]: 'missing' });
      return;
    }
    const uploads = files.take();
    if (!uploads) return;
    writeDraft(draft, '');
    onSend(text.trim(), draft, uploads);
  }

  return (
    <form onSubmit={submit} className="shrink-0 space-y-2 border-t bg-background p-4">
      <KiAttachmentList
        uploads={files.uploads}
        uploading={files.uploading}
        onRemove={files.remove}
        onCancel={files.cancel}
      />
      <div className="flex items-end gap-2">
        <KiAttachButtons onSelect={files.add} />
        <Field
          label={`Nachricht an ${AI_PRODUCT_NAME}`}
          hideLabel
          htmlFor={COMPOSER_ID}
          error={missing ? 'Schreib zuerst eine Nachricht.' : undefined}
          className="flex-1"
        >
          <Textarea
            value={text}
            placeholder="Frag etwas …"
            className="max-h-48"
            onChange={(event) => {
              setMissing(false);
              writeDraft(draft, event.target.value);
            }}
            onKeyDown={(event) => {
              if (running || !sendsOnEnter(event)) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
          />
        </Field>
        <ComposerAction running={running} stopping={stopping} onStop={onStop} />
      </div>
      <ComposerNotes errors={[files.error, error]} />
    </form>
  );
});
