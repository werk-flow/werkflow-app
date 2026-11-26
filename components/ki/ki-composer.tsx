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

// The composer stays mounted while the person switches threads (brief
// non-negotiable 8); its drafts live in ki-drafts.ts.

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

export const KiComposer = memo(function KiComposer({
  draft,
  running,
  error,
  onSend,
  onStop,
}: {
  /** The sessionStorage key of the open thread's draft. */
  draft: string;
  /** An answer is being written: the composer offers to stop it instead of sending. */
  running: boolean;
  error: string | null;
  /** Sends the text of the draft under `draft`; the composer has already cleared it. */
  onSend: (text: string, draft: string) => void;
  onStop: () => void;
}): React.JSX.Element {
  const text = useSyncExternalStore(
    subscribeDrafts,
    () => readDraft(draft),
    () => '',
  );
  const [missing, setMissing] = useState(false);

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    // While an answer runs, the composer only keeps the draft; stopping is its own button.
    if (running) return;
    if (!text.trim()) {
      setMissing(true);
      focusFirstInvalidField({ [COMPOSER_ID]: 'missing' });
      return;
    }
    writeDraft(draft, '');
    onSend(text.trim(), draft);
  }

  return (
    <form onSubmit={submit} className="shrink-0 space-y-2 border-t bg-background p-4">
      <div className="flex items-end gap-2">
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
        {/* Two elements, not one that changes its type: a click that stops the answer must not
            end as a submit of the button it re-rendered into. */}
        {running ? (
          <Button key="stop" type="button" size="icon" variant="outline" className="size-11" onClick={onStop}>
            <Square />
            <span className="sr-only">Antwort anhalten</span>
          </Button>
        ) : (
          <Button key="send" type="submit" size="icon" className="size-11">
            <ArrowUp />
            <span className="sr-only">Senden</span>
          </Button>
        )}
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <p className="text-xs text-muted-foreground">
        {AI_PRODUCT_NAME} ist eine KI und kann sich irren. Prüf wichtige Angaben, bevor du sie verwendest.
      </p>
    </form>
  );
});
