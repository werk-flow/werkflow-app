import { describeFailure } from '@/lib/action-messages';
import { AI_PRODUCT_NAME } from '@/lib/ai/name';
import { aiThreadRowSchema } from '@/lib/ai/thread-rows';
import { z } from '@/lib/zod';

// The browser side of `POST /api/ki/threads/[threadId]/turns`
// (docs/features/ai-automations.md, "Model path"): it sends one message and
// reads the answer's newline-delimited events as they arrive.

/** What a person reads when a turn did not start; the route answers with a stable code. */
const REFUSAL_MESSAGES: Readonly<Record<string, string>> = {
  not_released: `${AI_PRODUCT_NAME} ist für deinen Betrieb nicht freigeschaltet.`,
  disabled: `${AI_PRODUCT_NAME} ist in deinem Betrieb ausgeschaltet.`,
  thread_not_found: 'Diesen Chat gibt es nicht mehr. Fang bitte einen neuen an.',
  run_active: 'Eine andere Antwort wird gerade noch geschrieben. Warte, bis sie fertig ist.',
  command_conflict: 'Diese Nachricht wurde schon gesendet. Schick sie bitte noch einmal.',
  too_many_turns: 'Du hast gerade sehr viele Fragen gestellt. Warte etwas und versuch es dann noch einmal.',
  budget_exhausted: `Das Monatsbudget für ${AI_PRODUCT_NAME} ist aufgebraucht. Im nächsten Monat geht es weiter.`,
};

export function describeTurnRefusal(code: string): string {
  return describeFailure(
    code,
    REFUSAL_MESSAGES,
    `${AI_PRODUCT_NAME} ist gerade nicht erreichbar. Versuch es gleich noch einmal.`,
  );
}

const itemRef = z.object({ id: z.string(), sequence: z.number() });
const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started'), userItem: itemRef, assistantItem: itemRef }),
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({ type: z.literal('row'), row: aiThreadRowSchema }),
  z.object({
    type: z.literal('end'),
    status: z.enum(['complete', 'failed', 'cancelled']),
    message: z.string().optional(),
  }),
]);
export type TurnEvent = z.infer<typeof eventSchema>;

export type TurnOutcome =
  | { kind: 'answered' }
  /** The command ran before, in another request: its answer is saved. */
  | { kind: 'already_done' }
  /** `spent`: the command can never run (`command_conflict`), so the message goes again as a new one. */
  | { kind: 'refused'; message: string; spent?: true }
  | { kind: 'stopped' };

/**
 * Sends one message and calls `onEvent` for each event of its answer. A
 * refusal, a lost connection and a stream that closes without its end event
 * come back as a German sentence; an aborted read as `stopped`.
 * The server goes on writing the answer when the client stops reading.
 */
export async function sendTurn(input: {
  organizationId: string;
  threadId: string;
  commandId: string;
  text: string;
  signal: AbortSignal;
  onEvent: (event: TurnEvent) => void;
}): Promise<TurnOutcome> {
  const { organizationId, threadId, commandId, text, signal, onEvent } = input;
  try {
    const response = await fetch(`/api/ki/threads/${threadId}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId, commandId, text }),
      signal,
    });
    if (!response.ok || !response.body) {
      const body: unknown = await response.json().catch(() => null);
      const refusal = z.object({ error: z.string() }).safeParse(body);
      const code = refusal.success ? refusal.data.error : 'unavailable';
      const message = describeTurnRefusal(code);
      return code === 'command_conflict'
        ? { kind: 'refused', message, spent: true }
        : { kind: 'refused', message };
    }
    if (!response.headers.get('Content-Type')?.includes('ndjson')) return { kind: 'already_done' };
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let pending = '';
    let ended = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += value;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const event = eventSchema.safeParse(JSON.parse(line));
        if (!event.success) continue;
        ended ||= event.data.type === 'end';
        onEvent(event.data);
      }
    }
    // A stream that closes without its end event broke off; it never reads as answered.
    return ended ? { kind: 'answered' } : { kind: 'refused', message: describeTurnRefusal('unavailable') };
  } catch (error) {
    if (signal.aborted) return { kind: 'stopped' };
    return { kind: 'refused', message: describeTurnRefusal(error instanceof Error ? error.name : '') };
  }
}
