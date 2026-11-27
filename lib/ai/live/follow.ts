import type { KiLiveEvent } from '@/lib/ai/live/events';
import type { AiChatMessage, AiThreadEntry, AiThreadRow, AiThreadWindow } from '@/lib/ai/thread-types';

// How a tab follows a thread from its live channel (werk-flow/werkflow-planning#532):
// resume is a snapshot plus a sequence cursor. The snapshot is the thread's
// saved window; the live events extend it at their offsets; a gap is filled
// by reading the thread from the cursor on, then the held events apply again.

const userKey = (command: string): string => `${command}:user`;
const answerKey = (command: string): string => `${command}:assistant`;

/** Whether an entry is a message, as opposed to a row of the agent's work. */
export function isChatMessage(entry: AiThreadEntry): entry is AiChatMessage {
  return entry.role === 'user' || entry.role === 'assistant';
}

/**
 * Which of two copies of one entry to show. A snapshot never takes back a
 * finished answer for an older copy still being written, nor shortens an
 * answer still being written that the page holds further; a row shows its
 * higher revision. An unchanged entry keeps its object, so it does not render
 * again.
 */
export function fresherMessage<Entry extends AiThreadEntry>(held: Entry, read: Entry): Entry {
  if (!isChatMessage(held) || !isChatMessage(read)) {
    const heldRevision = isChatMessage(held) ? 0 : held.revision;
    return !isChatMessage(read) && read.revision > heldRevision ? read : held;
  }
  if (read.status === 'streaming') {
    if (held.status !== 'streaming') return held;
    if (held.text.length > read.text.length && held.text.startsWith(read.text)) return held;
  }
  const same =
    held.sequence === read.sequence &&
    held.status === read.status &&
    held.text === read.text &&
    held.failure === read.failure;
  return same ? held : read;
}

const bySequence = (left: AiThreadEntry, right: AiThreadEntry): number => left.sequence - right.sequence;

function withMessages(window: AiThreadWindow, messages: AiThreadEntry[]): AiThreadWindow {
  return { ...window, messages: messages.toSorted(bySequence) };
}

/**
 * Where a catch-up read starts: the first answer still being written, the
 * first sequence missing between messages the page holds (a turn of another
 * device it never saw, even when its own later turn settled after it), or
 * after the last message. Everything before it is final.
 */
export function kiLiveCursor(window: AiThreadWindow | null): number {
  const messages = window?.messages ?? [];
  const sequences = messages.map((message) => message.sequence).toSorted((left, right) => left - right);
  let firstMissing = (sequences.at(-1) ?? 0) + 1;
  for (let index = 1; index < sequences.length; index += 1) {
    const previous = sequences[index - 1] ?? 0;
    if ((sequences[index] ?? 0) > previous + 1) {
      firstMissing = previous + 1;
      break;
    }
  }
  const writing = messages.find((message) => message.status === 'streaming')?.sequence;
  return Math.min(writing ?? firstMissing, firstMissing);
}

/** A read of the messages from the cursor on, joined with what the page holds: nothing held is dropped. */
export function mergeNewer(held: AiThreadWindow | null, read: AiThreadWindow): AiThreadWindow {
  const byKey = new Map((held?.messages ?? []).map((message) => [message.key, message]));
  for (const message of read.messages) {
    const old = byKey.get(message.key);
    byKey.set(message.key, old ? fresherMessage(old, message) : message);
  }
  return withMessages({ hasOlder: held?.hasOlder ?? read.hasOlder, messages: [] }, [...byKey.values()]);
}

/** A thread's window with a row in place of its older copy; an unchanged row keeps the window. */
export function placeRow(window: AiThreadWindow, row: AiThreadRow): AiThreadWindow {
  const held = window.messages.find((message) => message.key === row.key);
  const next = held ? fresherMessage<AiThreadEntry>(held, row) : row;
  if (next === held) return window;
  return withMessages(window, [...window.messages.filter((message) => message !== held), next]);
}

/**
 * A read window joined with what the page holds, each entry once by its key
 * and in sequence order. A read never takes back an answer for an older
 * snapshot of it (lib/ai/live/follow.ts), and keeps the entries it did not
 * cover: turns settled after the read began, and older pages already shown
 * when they reach the window without a gap. The window holds every kind of
 * entry, rows included, so a row at its edge leaves no gap. An unchanged
 * entry keeps its object, so it does not render again.
 */
export function mergeWindow(previous: AiThreadWindow | null, next: AiThreadWindow): AiThreadWindow {
  const held = new Map(previous?.messages.map((message) => [message.key, message]));
  const read = new Set(next.messages.map((message) => message.key));
  const first = Math.min(...next.messages.map((message) => message.sequence));
  const fresh = next.messages.map((message) => {
    const old = held.get(message.key);
    return old ? fresherMessage(old, message) : message;
  });
  const unread = (previous?.messages ?? []).filter((message) => !read.has(message.key));
  // Older pages stay only when they reach the read window; otherwise paging starts at the window again.
  const older = unread.filter((message) => message.sequence < first);
  // An empty read has nothing to place the held messages against, so they all stay.
  const connected =
    next.messages.length === 0 ||
    (older.length > 0 && Math.max(...older.map((message) => message.sequence)) === first - 1);
  const kept = connected ? unread : unread.filter((message) => message.sequence > first);
  return {
    hasOlder: connected ? (previous?.hasOlder ?? false) : next.hasOlder,
    messages: [...kept, ...fresh].toSorted((left, right) => left.sequence - right.sequence),
  };
}

/** Whether the window lacks one of these rows, or holds it at an older revision. */
function missesRows(window: AiThreadWindow, rows: readonly { key: string; revision: number }[]): boolean {
  return rows.some(({ key, revision }) => {
    const held = window.messages.find((message) => message.key === key);
    return !held || isChatMessage(held) || held.revision < revision;
  });
}

/**
 * One live event applied to a thread's window. `applied: false` means the
 * window lacks what the event builds on (its answer, or text before its
 * offset): the caller holds the event, reads the thread from the cursor and
 * applies it again. An event the window already holds changes nothing.
 */
function applyKiLiveEvent(
  window: AiThreadWindow,
  event: KiLiveEvent,
): { window: AiThreadWindow; applied: boolean } {
  const unchanged = { window, applied: true };
  // A row has its own place in the thread: it lands at once, and a catch-up fills what lies before it.
  if (event.type === 'row') return { window: placeRow(window, event.row), applied: true };
  if (event.type === 'started') {
    const keys = new Set(window.messages.map((message) => message.key));
    // A turn that starts past messages the page never saw waits, so the cursor does not skip them. A
    // retried command keeps its saved message, so its answer can land past a missing sequence too.
    const last = Math.max(0, ...window.messages.map((message) => message.sequence));
    const userHeld = keys.has(userKey(event.command));
    const userGap = !userHeld && event.user.sequence > last + 1;
    const answerGap =
      !keys.has(answerKey(event.command)) &&
      event.answer.sequence > (userHeld ? last : event.user.sequence) + 1;
    if (userGap || answerGap) return { window, applied: false };
    const added: AiChatMessage[] = [];
    if (!keys.has(userKey(event.command)))
      added.push({
        key: userKey(event.command),
        sequence: event.user.sequence,
        role: 'user',
        status: 'complete',
        text: event.user.text,
        failure: null,
      });
    if (!keys.has(answerKey(event.command)))
      added.push({
        key: answerKey(event.command),
        sequence: event.answer.sequence,
        role: 'assistant',
        status: 'streaming',
        text: '',
        failure: null,
      });
    return added.length === 0
      ? unchanged
      : { window: withMessages(window, [...window.messages, ...added]), applied: true };
  }
  const answer = window.messages.find(
    (message): message is AiChatMessage => message.key === answerKey(event.command) && isChatMessage(message),
  );
  if (!answer) return { window, applied: false };
  if (answer.status !== 'streaming') return unchanged;
  let next: AiThreadEntry;
  if (event.type === 'text') {
    if (event.at > answer.text.length) return { window, applied: false };
    const fresh = event.delta.slice(answer.text.length - event.at);
    if (!fresh) return unchanged;
    next = { ...answer, text: answer.text + fresh };
  } else {
    // The answer's end with text or a row this page never received: the saved thread holds them, and
    // the cursor stays at the answer, before every row of its turn.
    if (answer.text.length < event.length || missesRows(window, event.rows ?? []))
      return { window, applied: false };
    next = { ...answer, status: event.status, failure: event.failure };
  }
  return {
    window: { ...window, messages: window.messages.map((message) => (message === answer ? next : message)) },
    applied: true,
  };
}

/**
 * Whether a read of the thread from the cursor can fill what the held events
 * miss: the answer's end is saved by the time it is sent, and text is saved up
 * to the latest event's `saved`. Text past what is saved waits for the next
 * partial save instead of a read that could not fill the gap.
 */
export function kiLiveGapFillable(held: readonly KiLiveEvent[]): boolean {
  const first = held[0];
  if (!first) return false;
  if (held.some((event) => event.type !== 'text')) return true;
  const latest = held.at(-1);
  return first.type === 'text' && latest?.type === 'text' && latest.saved >= first.at;
}

/** Events a tab holds while it waits to fill a gap: about two minutes of a fast answer. */
const KI_LIVE_HELD_EVENTS = 500;

/**
 * Applies held events in order; the ones the window cannot take yet stay held,
 * at most `KI_LIVE_HELD_EVENTS`. `stale` says that a new turn started while an
 * older answer still shows as written, so a catch-up read settles that one.
 */
export function applyKiLiveEvents(
  window: AiThreadWindow,
  events: readonly KiLiveEvent[],
): { window: AiThreadWindow; held: KiLiveEvent[]; stale: boolean } {
  let current = window;
  const held: KiLiveEvent[] = [];
  let stale = false;
  for (const event of events) {
    // A new turn starts while an older answer still shows as written: that answer's end never came.
    if (event.type === 'started')
      stale ||= current.messages.some(
        (message) => message.status === 'streaming' && message.key !== answerKey(event.command),
      );
    const result = applyKiLiveEvent(current, event);
    current = result.window;
    if (!result.applied) held.push(event);
  }
  return { window: current, held: held.slice(-KI_LIVE_HELD_EVENTS), stale };
}
