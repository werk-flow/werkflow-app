'use client';

import { ArrowUp, Square } from 'lucide-react';
import { memo, useState, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { AI_PRODUCT_NAME } from '@/lib/ai/name';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

// The composer stays mounted while the person switches threads (brief
// non-negotiable 8). Each thread keeps its own draft in this tab's
// sessionStorage, so a draft survives navigation and reload and leaves the
// device with the tab. A memory copy carries it when storage is refused.

const COMPOSER_ID = 'ki-composer';
const memoryDrafts = new Map<string, string>();
const draftListeners = new Set<() => void>();

function subscribeDrafts(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => draftListeners.delete(listener);
}

function readDraft(key: string): string {
  const kept = memoryDrafts.get(key);
  if (kept !== undefined) return kept;
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/** Saves or clears the draft under `key`. */
export function writeDraft(key: string, text: string): void {
  memoryDrafts.set(key, text);
  try {
    if (text) sessionStorage.setItem(key, text);
    else sessionStorage.removeItem(key);
  } catch {
    // best-effort: the memory copy keeps the draft for this page when the browser refuses storage.
  }
  for (const listener of draftListeners) listener();
}

export function draftKey(userId: string, threadId: string | null): string {
  return `werkflow:ki-draft:${userId}:${threadId ?? 'neu'}`;
}

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
  /** Sends the text; the composer has already cleared its draft. */
  onSend: (text: string) => void;
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
    if (running) return onStop();
    if (!text.trim()) {
      setMissing(true);
      focusFirstInvalidField({ [COMPOSER_ID]: 'missing' });
      return;
    }
    writeDraft(draft, '');
    onSend(text.trim());
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
              if (!sendsOnEnter(event)) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
          />
        </Field>
        <Button type="submit" size="icon" variant={running ? 'outline' : 'default'} className="size-11">
          {running ? <Square /> : <ArrowUp />}
          <span className="sr-only">{running ? 'Antwort anhalten' : 'Senden'}</span>
        </Button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <p className="text-xs text-muted-foreground">
        {AI_PRODUCT_NAME} ist eine KI und kann sich irren. Prüf wichtige Angaben, bevor du sie verwendest.
      </p>
    </form>
  );
});
