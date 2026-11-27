import type { AiThreadRow } from '@/lib/ai/thread-types';
import type { AiTurnEnd, AiTurnSink } from '@/lib/ai/turn';

/** Text deltas reach the client at most this often (brief non-negotiable 4). */
const DELTA_BATCH_MS = 50;

/** Runs a task after a delay and returns its cancel; tests pass a manual one. */
export type Schedule = (run: () => void, delayMs: number) => () => void;

export const timerSchedule: Schedule = (run, delayMs) => {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
};

type TurnEvent =
  | {
      type: 'started';
      userItem: { id: string; sequence: number };
      assistantItem: { id: string; sequence: number };
    }
  | { type: 'text'; delta: string }
  | { type: 'row'; row: AiThreadRow }
  | ({ type: 'end' } & AiTurnEnd);

/**
 * The turn's answer as newline-delimited JSON. Deltas are batched, so a fast
 * model sends one line per batch instead of one per token. A client that
 * leaves stops receiving; the run itself goes on and saves the answer.
 */
export function createTurnEventStream(schedule: Schedule = timerSchedule): {
  readable: ReadableStream<Uint8Array>;
  sink: AiTurnSink;
  send: (event: TurnEvent) => void;
  end: (end: AiTurnEnd) => void;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let pending = '';
  let cancelFlush: (() => void) | null = null;

  const readable = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
    cancel() {
      controller = null;
    },
  });

  const send = (event: TurnEvent): void => {
    if (!controller) return;
    try {
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    } catch {
      controller = null;
    }
  };
  const flush = (): void => {
    cancelFlush = null;
    if (!pending) return;
    send({ type: 'text', delta: pending });
    pending = '';
  };

  return {
    readable,
    send,
    sink: {
      text(delta) {
        pending += delta;
        cancelFlush ??= schedule(flush, DELTA_BATCH_MS);
      },
      // A row follows the text written before it at once.
      row(row) {
        cancelFlush?.();
        flush();
        send({ type: 'row', row });
      },
    },
    end(end) {
      cancelFlush?.();
      flush();
      send({ type: 'end', ...end });
      controller?.close();
      controller = null;
    },
  };
}
