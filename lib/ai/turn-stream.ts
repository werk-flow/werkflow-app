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
      /** The file items the message attached, by file id. */
      files?: Array<{ fileId: string; sequence: number }>;
    }
  | { type: 'text'; delta: string }
  | ({ type: 'end' } & AiTurnEnd);

/**
 * The turn's answer as newline-delimited JSON. Deltas are batched, so a fast
 * model sends one line per batch instead of one per token. A client that
 * leaves stops receiving; the run itself goes on and saves the answer.
 * An author who lost the thread receives no more text.
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
  let revoked = false;

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
        if (revoked) return;
        pending += delta;
        cancelFlush ??= schedule(flush, DELTA_BATCH_MS);
      },
      revoked() {
        // The author lost the thread: no more of its answer reaches them, only the turn's end.
        revoked = true;
        pending = '';
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
