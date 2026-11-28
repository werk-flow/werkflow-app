'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useClientRead } from '@/hooks/use-client-read';
import {
  holdSendingAttachments,
  moveAttachments,
  restoreAttachments,
  takeSendingAttachments,
} from './attachment-drafts';
import type { AiUploadedFile } from '@/lib/ai/files/types';
import type { KiLiveEvent } from '@/lib/ai/live/events';
import {
  applyKiLiveEvents,
  fresherMessage,
  kiLiveCursor,
  kiLiveGapFillable,
  mergeNewer,
  mergeWindow,
  placeRow,
} from '@/lib/ai/live/follow';
import type { AiThreadEntry, AiThreadRow, AiThreadSummary, AiThreadWindow } from '@/lib/ai/thread-types';
import { readInBackground } from '@/lib/data/background-read-client';
import {
  draftClears,
  type RetryCommand,
  draftKey,
  holdRetry,
  holdSending,
  readDraft,
  releaseSending,
  takeRetry,
  takeSending,
  writeDraft,
} from '@/lib/ai/chat-drafts';
import { kiThreadHref } from './ki-thread-list';
import type { TimelineMessage } from './ki-timeline';
import { describeTurnRefusal, sendTurn, type TurnEvent, type TurnOutcome } from './turn-client';
import { useKiLive } from './use-ki-live';
import { useStop } from './use-ki-stop';

// The chat page's state (werk-flow/werkflow-planning#530): the thread list,
// the threads read so far, the thread on screen and the one running turn.
// A switch changes the address through the history API, shows the last known
// messages at once and reads the thread again (brief non-negotiables 1 and 8).
// The thread on screen follows its live channel (use-ki-live.ts): a turn of
// another tab or device streams in, and a gap is filled from the cursor.
// Prefetch (KI-11) builds on `readWindow`.

export type ThreadView = { window: AiThreadWindow | null; confirmed: boolean; failed: boolean };
export type ThreadList = { threads: AiThreadSummary[]; hasMore: boolean };

export type LiveTurn = {
  threadId: string;
  commandId: string;
  /** The draft the message came from: a refusal puts it back there. */
  draft: string;
  /** A new chat's thread, which exists only once the message is saved. */
  provisional: boolean;
  /** The person's message: one object for the whole turn, so it never renders again while the answer streams. */
  user: TimelineMessage;
  /** The uploads the message attaches, and their file items as the timeline shows them. */
  uploads: readonly AiUploadedFile[];
  files: readonly TimelineMessage[];
  answer: string;
  /** The answer's sequence in its thread, from the moment the message is saved. */
  answerSequence: number;
  started: boolean;
  /** The answer's length when the person pressed „Antwort anhalten“: the screen holds it there until the end. */
  stoppedAt: number | null;
  end: { status: 'complete' | 'failed' | 'cancelled'; message: string | null } | null;
  /** A tapped answer to a question: a refusal keeps it out of the typed draft. */
  tap: boolean;
};

/** Where a refused message waits for its unchanged retry: a tapped answer apart from the typed draft. */
const retryKey = (draft: string, tap: boolean): string => (tap ? `${draft}#tap` : draft);

type WindowRead = 'found' | 'missing' | 'failed';

/** A read that says the thread is not this person's here: what the page showed of it goes. */
const DENIED_READS = new Set([
  'not_found',
  'not_authenticated',
  'not_a_member',
  'no_active_org',
  'organization_changed',
  'not_authorized',
]);

const EMPTY_WINDOW: AiThreadWindow = { messages: [], hasOlder: false };

function userMessage(
  commandId: string,
  text: string,
  sequence: number,
  unconfirmed: boolean,
): TimelineMessage {
  return {
    key: `${commandId}:user`,
    sequence,
    role: 'user',
    status: 'complete',
    text,
    failure: null,
    ...(unconfirmed ? { unconfirmed } : {}),
  };
}

/** The file item an upload becomes in the thread, under the key the server gives it. */
function fileMessage(
  commandId: string,
  upload: AiUploadedFile,
  sequence: number,
  unconfirmed: boolean,
): TimelineMessage {
  return {
    key: `${commandId}:file:${upload.fileId}`,
    sequence,
    role: 'file',
    status: 'complete',
    text: '',
    failure: null,
    file: { ...upload, origin: 'upload' },
    ...(unconfirmed ? { unconfirmed } : {}),
  };
}

export function answerMessage(live: LiveTurn): TimelineMessage {
  return {
    key: `${live.commandId}:assistant`,
    sequence: live.answerSequence,
    role: 'assistant',
    status: live.end?.status ?? 'streaming',
    // Held still only until the end: an answer that completed before the stop landed is whole.
    text: live.stoppedAt === null || live.end ? live.answer : live.answer.slice(0, live.stoppedAt),
    failure: live.end?.message ?? null,
  };
}

export function useThreadList(organizationId: string, initial: ThreadList) {
  const [list, setList] = useState(initial);
  // The page the person asked for: the threads after the last one shown.
  const [before, setBefore] = useState<{ updatedAt: string; id: string } | null>(null);
  const [appended, setAppended] = useState<typeof before>(null);
  const older = useClientRead({
    read: (signal) =>
      readInBackground('ki-thread-page', { organizationId, ...(before ? { before } : {}) }, signal),
    deps: [organizationId, before?.updatedAt, before?.id],
    enabled: before !== null,
    failureMessage: 'Ältere Chats konnten nicht geladen werden.',
  });
  // A page that arrived joins the list once, during render (no effect copies it).
  if (older.data && before !== appended) {
    const page = older.data;
    setAppended(before);
    setList((current) => ({
      hasMore: page.hasMore,
      threads: [
        ...current.threads,
        ...page.threads.filter((thread) => !current.threads.some((known) => known.id === thread.id)),
      ],
    }));
  }
  const last = list.threads.at(-1);
  const loadMore = useCallback(() => {
    if (last) setBefore({ updatedAt: last.updatedAt, id: last.id });
  }, [last]);
  /** Puts a thread that just took a message at the top. */
  const touch = useCallback((id: string, text: string) => {
    setList((current) => {
      const title = current.threads.find((thread) => thread.id === id)?.title ?? text;
      const others = current.threads.filter((thread) => thread.id !== id);
      return { ...current, threads: [{ id, title, updatedAt: new Date().toISOString() }, ...others] };
    });
  }, []);
  /** Drops a thread the person can no longer open, title included. */
  const evict = useCallback((id: string) => {
    setList((current) => ({ ...current, threads: current.threads.filter((thread) => thread.id !== id) }));
  }, []);
  return { list, failure: older.failure, loadingMore: older.loading, loadMore, touch, evict };
}

/** Moves the thread's count on by one and returns it. */
function countOn(counts: Map<string, number>, id: string): number {
  const next = (counts.get(id) ?? 0) + 1;
  counts.set(id, next);
  return next;
}

type ViewChange = (all: Record<string, ThreadView>) => Record<string, ThreadView>;

/**
 * The thread reads of the page: the latest window, the page before `before`,
 * or the messages from the live cursor on (`after`). A denied read takes the
 * thread off the page; `afterRead` runs after each read that landed.
 */
function useWindowRead(
  organizationId: string,
  missing: React.RefObject<(threadId: string) => void>,
  update: (change: ViewChange) => void,
  afterRead: React.RefObject<(id: string) => void>,
) {
  // A read that answers after the page is gone touches neither its state nor the address.
  const reads = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    reads.current = controller;
    return () => controller.abort();
  }, []);
  // Each thread's stamp moves on with every read and every turn sent to it.
  const stamps = useRef(new Map<string, number>());
  const stamp = useCallback((id: string): number => countOn(stamps.current, id), []);
  // And with every read of its latest messages: only the newest of those may show what it read.
  const latestReads = useRef(new Map<string, number>());
  const read = useCallback(
    async (id: string, bound: { before?: number; after?: number }): Promise<WindowRead> => {
      const signal = reads.current.signal;
      const mine = stamp(id);
      const latest =
        bound.before === undefined && bound.after === undefined ? countOn(latestReads.current, id) : null;
      const result = await readInBackground(
        'ki-thread-window',
        {
          organizationId,
          threadId: id,
          ...(bound.before ? { beforeSequence: bound.before } : {}),
          ...(bound.after ? { afterSequence: bound.after } : {}),
        },
        signal,
      );
      if (signal.aborted) return 'failed';
      if (!result.success && DENIED_READS.has(result.error)) {
        // A newer read or turn of the thread has the last word: a retry may have saved it since.
        if (stamps.current.get(id) !== mine) return 'failed';
        update((all) => Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)));
        missing.current(id);
        return 'missing';
      }
      // An earlier read of the latest messages that answers after a newer one would show older text.
      if (latest !== null && latestReads.current.get(id) !== latest)
        return result.success ? 'found' : 'failed';
      update((all) => {
        const current = all[id]?.window ?? null;
        // A passing failure keeps what was shown, still marked unconfirmed.
        if (!result.success) return { ...all, [id]: { window: current, confirmed: false, failed: true } };
        // A catch-up that fitted holds only newer messages; one that did not is the latest window.
        const merged =
          bound.after && !result.window.hasOlder
            ? mergeNewer(current, result.window)
            : mergeWindow(current, result.window);
        return { ...all, [id]: { window: merged, confirmed: true, failed: false } };
      });
      if (result.success) afterRead.current(id);
      return result.success ? 'found' : 'failed';
    },
    [organizationId, missing, stamp, update, afterRead],
  );
  return { read, stamp };
}

function useThreadViews(
  organizationId: string,
  initialThreadId: string | null,
  initialWindow: AiThreadWindow | null,
  missing: React.RefObject<(threadId: string) => void>,
) {
  const [views, setViews] = useState<Record<string, ThreadView>>(() =>
    initialThreadId && initialWindow
      ? { [initialThreadId]: { window: initialWindow, confirmed: true, failed: false } }
      : {},
  );
  // The views as of the last change, so a live event decides against what it lands on.
  const viewsRef = useRef(views);
  const update = useCallback((change: ViewChange) => {
    viewsRef.current = change(viewsRef.current);
    setViews(viewsRef.current);
  }, []);
  // Live events that waited for this thread's read apply once it landed.
  const afterRead = useRef<(id: string) => void>(() => undefined);
  const { read, stamp } = useWindowRead(organizationId, missing, update, afterRead);
  const readWindow = useCallback(
    (id: string, beforeSequence?: number) => read(id, beforeSequence ? { before: beforeSequence } : {}),
    [read],
  );
  /** Shows the last known messages, marked unconfirmed, and reads the thread again. */
  const reopen = useCallback(
    (id: string) => {
      update((all) => {
        const current = all[id];
        return current ? { ...all, [id]: { ...current, confirmed: false, failed: false } } : all;
      });
      void readWindow(id);
    },
    [readWindow, update],
  );
  /** Puts a turn's messages into its thread, in place of earlier copies under the same keys, unless those are further on. */
  const settle = useCallback(
    (id: string, turn: readonly TimelineMessage[], confirmed: boolean) => {
      update((all) => {
        // A thread that just took its first message exists from now on; a known one keeps its state.
        if (turn.length === 0 && all[id]) return all;
        const window = all[id]?.window ?? EMPTY_WINDOW;
        const held = new Map(window.messages.map((message) => [message.key, message]));
        // The channel may have brought this turn further than this page's own copy.
        const settled = turn.map((message) => {
          const known = held.get(message.key);
          return known ? fresherMessage<AiThreadEntry>(known, message) : message;
        });
        const keys = new Set(turn.map((message) => message.key));
        const messages = [...window.messages.filter((message) => !keys.has(message.key)), ...settled];
        return { ...all, [id]: { window: { ...window, messages }, confirmed, failed: false } };
      });
    },
    [update],
  );
  /** Puts a row of the running turn into its thread, in place of an older copy. */
  const place = useCallback(
    (id: string, row: AiThreadRow) => {
      update((all) => {
        const view = all[id] ?? { window: null, confirmed: true, failed: false };
        return { ...all, [id]: { ...view, window: placeRow(view.window ?? EMPTY_WINDOW, row) } };
      });
    },
    [update],
  );
  const { receive, catchUp, drain } = useLiveFollow(viewsRef, update, read);
  useEffect(() => {
    afterRead.current = drain;
  });
  return { views, readWindow, reopen, settle, place, supersedeReads: stamp, receive, catchUp };
}

/**
 * The thread on screen as its live channel moves it on (brief non-negotiable
 * 9): each event extends the saved window; an event the window cannot take
 * yet waits until a read from the cursor fills the gap. A join reads from the
 * cursor too, so nothing sent while the tab was away stays missing.
 */
function useLiveFollow(
  viewsRef: React.RefObject<Record<string, ThreadView>>,
  update: (change: ViewChange) => void,
  read: (id: string, bound: { after: number }) => Promise<WindowRead>,
) {
  const held = useRef(new Map<string, KiLiveEvent[]>());
  const filling = useRef(new Set<string>());
  // A join or a gap that came while the thread's first read or a catch-up was on its way: one more read follows.
  const wanted = useRef(new Set<string>());
  /** Applies the thread's held events and the new one; returns whether a read could fill what is left. */
  const apply = useCallback(
    (id: string, events: readonly KiLiveEvent[]): boolean => {
      const queue = [...(held.current.get(id) ?? []), ...events];
      const window = viewsRef.current[id]?.window;
      // A thread not read yet takes the events once its first read landed.
      if (!window) {
        held.current.set(id, queue);
        return false;
      }
      const result = applyKiLiveEvents(window, queue);
      held.current.set(id, result.held);
      if (result.window !== window)
        update((all) => {
          const view = all[id];
          return view ? { ...all, [id]: { ...view, window: result.window } } : all;
        });
      return result.stale || kiLiveGapFillable(result.held);
    },
    [viewsRef, update],
  );
  /**
   * Reads the thread from the cursor on, one read at a time, and applies the
   * held events again. A request that comes while the thread has no window
   * yet or a read is on its way is kept, and one more read follows that one:
   * its snapshot may predate the event that asked.
   */
  const catchUp = useCallback(
    async (id: string): Promise<void> => {
      if (!viewsRef.current[id]?.window || filling.current.has(id)) {
        wanted.current.add(id);
        return;
      }
      filling.current.add(id);
      do {
        wanted.current.delete(id);
        const window = viewsRef.current[id]?.window;
        if (!window) break;
        await read(id, { after: kiLiveCursor(window) });
        apply(id, []);
      } while (wanted.current.has(id));
      filling.current.delete(id);
    },
    [viewsRef, read, apply],
  );
  const receive = useCallback(
    (id: string, event: KiLiveEvent) => {
      if (apply(id, [event])) void catchUp(id);
    },
    [apply, catchUp],
  );
  /** Applies what waited for a read that just landed; a catch-up's own read applies when it returns. */
  const drain = useCallback(
    (id: string) => {
      if (filling.current.has(id)) return;
      if (apply(id, []) || wanted.current.has(id)) void catchUp(id);
    },
    [apply, catchUp],
  );
  return { receive, catchUp, drain };
}

function useShownThread(initialThreadId: string | null, reopen: (id: string) => void) {
  const [threadId, setThreadId] = useState(initialThreadId);
  const shownRef = useRef(initialThreadId);
  /** Puts a thread on screen without reading it: a new one that is being created. */
  const showOnly = useCallback((id: string | null) => {
    shownRef.current = id;
    setThreadId(id);
  }, []);
  const show = useCallback(
    (id: string | null) => {
      showOnly(id);
      if (id) reopen(id);
    },
    [showOnly, reopen],
  );
  // A thread the server did not open (another organization's, after a switch) leaves the address.
  useEffect(() => {
    if (initialThreadId === null && new URLSearchParams(window.location.search).has('chat'))
      window.history.replaceState(null, '', kiThreadHref(null));
  }, [initialThreadId]);
  useEffect(() => {
    const onPopState = (): void => show(new URLSearchParams(window.location.search).get('chat'));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [show]);
  return { threadId, shownRef, show, showOnly };
}

type TurnHost = {
  organizationId: string;
  userId: string;
  threadId: string | null;
  shownRef: React.RefObject<string | null>;
  showOnly: (threadId: string | null) => void;
  touch: (threadId: string, text: string) => void;
  settle: (threadId: string, turn: readonly TimelineMessage[], confirmed: boolean) => void;
  place: (threadId: string, row: AiThreadRow) => void;
  readWindow: (threadId: string) => Promise<WindowRead>;
  /** A turn sent to the thread: no denied read that began before it may take the thread off the page. */
  supersedeReads: (threadId: string) => void;
};

/** The draft the composer shows: the thread's own, or the new chat's while a new thread waits to be saved. */
function draftFor(host: TurnHost, live: LiveTurn | null): string {
  const provisional = live?.provisional && !live.started && live.threadId === host.threadId;
  return draftKey(host.userId, host.organizationId, provisional ? null : host.threadId);
}

/** Moves the address to the thread while it is on screen; a turn of a page the person left never gets here. */
function showAddress(host: TurnHost, threadId: string): void {
  if (host.shownRef.current === threadId) window.history.replaceState(null, '', kiThreadHref(threadId));
}

/**
 * The turn's message is saved: a new thread takes its address, its place at
 * the top of the list and what was typed for it while it waited.
 */
function markStarted(
  turn: LiveTurn,
  event: Extract<TurnEvent, { type: 'started' }>,
  host: TurnHost,
): LiveTurn {
  releaseMessage(turn.draft);
  if (turn.provisional && host.shownRef.current === turn.threadId) {
    const typed = readDraft(turn.draft);
    const destination = draftKey(host.userId, host.organizationId, turn.threadId);
    const held = readDraft(destination);
    writeDraft(turn.draft, '');
    if (typed) writeDraft(destination, held ? `${held}\n\n${typed}` : typed);
    moveAttachments(turn.draft, destination);
  }
  showAddress(host, turn.threadId);
  host.settle(turn.threadId, [], true);
  host.touch(turn.threadId, turn.user.text);
  const user = userMessage(turn.commandId, turn.user.text, event.userItem.sequence, false);
  const sequences = new Map((event.files ?? []).map((file) => [file.fileId, file.sequence]));
  const files = turn.uploads.map((upload) =>
    fileMessage(turn.commandId, upload, sequences.get(upload.fileId) ?? 0, false),
  );
  return { ...turn, started: true, user, files, answerSequence: event.assistantItem.sequence };
}

/**
 * Puts a saved turn into its thread and the list. Only a whole answer is
 * final as streamed: an answer that ended early, a stopped one above all,
 * keeps the text the server saved, and without its end event the saved
 * answer says how it went on, so a read shows both.
 */
function settleSaved(current: LiveTurn, outcome: TurnOutcome, host: TurnHost): void {
  showAddress(host, current.threadId);
  host.touch(current.threadId, current.user.text);
  if (current.end?.status === 'complete')
    return host.settle(current.threadId, [...current.files, current.user, answerMessage(current)], true);
  // Without its end event the answer stays open: the server goes on writing it, the thread's live
  // channel brings the rest, and a read now shows what is saved.
  host.settle(
    current.threadId,
    outcome.kind === 'already_done' ? [] : [...current.files, current.user, answerMessage(current)],
    false,
  );
  void host.readWindow(current.threadId);
}

/** A row of the running turn goes into the turn's thread. */
function placeRowOf(turn: LiveTurn | null, host: TurnHost, row: AiThreadRow): void {
  if (turn) host.place(turn.threadId, row);
}

/** Keeps a copy of a message and its uploads until its turn saved them. */
function holdMessage(message: Parameters<typeof holdSending>[0], uploads: readonly AiUploadedFile[]): void {
  holdSending(message);
  holdSendingAttachments(message.draft, uploads);
}

function releaseMessage(draft: string): void {
  releaseSending(draft);
  holdSendingAttachments(draft, []);
}

/** A refused message's text and files go back into its own draft, before what was added there meanwhile. */
function restoreMessage(key: string, text: string, uploads: readonly AiUploadedFile[]): void {
  restoreDraft(key, text);
  restoreAttachments(key, uploads);
}

/** The text of a refused message goes back into its own draft, before what was typed there meanwhile. */
function restoreDraft(key: string, text: string): void {
  const typed = readDraft(key);
  writeDraft(key, typed ? `${text}\n\n${typed}` : text);
}

/** Messages whose page went before their turns started go back into their drafts, each as the same command. */
function restoreUnsent(host: TurnHost): void {
  for (const { draft, threadId, commandId, text } of takeSending(host.userId, host.organizationId)) {
    const uploads = takeSendingAttachments(draft);
    holdRetry(draft, { threadId, commandId, text, fileIds: uploads.map((upload) => upload.fileId) });
    restoreMessage(draft, text, uploads);
  }
}

function newTurn(
  threadId: string,
  commandId: string,
  text: string,
  draft: string,
  provisional: boolean,
  uploads: readonly AiUploadedFile[],
  tap: boolean,
): LiveTurn {
  const user = userMessage(commandId, text, 0, true);
  return {
    threadId,
    commandId,
    draft,
    provisional,
    user,
    uploads,
    files: uploads.map((upload) => fileMessage(commandId, upload, 0, true)),
    answer: '',
    answerSequence: 0,
    started: false,
    stoppedAt: null,
    end: null,
    tap,
  };
}

/**
 * A message refused before its turn started: its text goes back into its own
 * draft, which keeps the command for an unchanged retry, or a new one when the
 * refused command can never run. The route may have saved the message before
 * it refused, so the thread is read again, and a new thread that exists after
 * all joins the list.
 */
function settleRefused(turn: LiveTurn, outcome: TurnOutcome, host: TurnHost): void {
  const commandId = outcome.kind === 'refused' && outcome.spent ? crypto.randomUUID() : turn.commandId;
  holdRetry(retryKey(turn.draft, turn.tap), {
    threadId: turn.threadId,
    commandId,
    text: turn.user.text,
    fileIds: turn.uploads.map((upload) => upload.fileId),
  });
  // A tapped answer is tapped again; only a typed message and its files go back into the draft.
  if (!turn.tap) restoreMessage(turn.draft, turn.user.text, turn.uploads);
  if (turn.provisional && host.shownRef.current === turn.threadId) host.showOnly(null);
  void host.readWindow(turn.threadId).then((read) => {
    if (read === 'found') host.touch(turn.threadId, turn.user.text);
  });
}

/**
 * The thread and command of a message: only an unchanged resend after a refusal is the same command. From the
 * new chat, it or a changed one that keeps a file of it goes to the refused message's thread (`earlier`).
 */
function commandFor(
  text: string,
  uploads: readonly AiUploadedFile[],
  host: TurnHost,
  refused: RetryCommand | undefined,
): { target: string; commandId: string; earlier: boolean } {
  const retry =
    refused?.text === text &&
    sameFiles(refused.fileIds, uploads) &&
    (host.threadId === null || host.threadId === refused.threadId)
      ? refused
      : undefined;
  const keeps = uploads.some((upload) => refused?.fileIds.includes(upload.fileId)) ? refused : undefined;
  const earlier = host.threadId === null ? (retry ?? keeps)?.threadId : undefined;
  return {
    target: host.threadId ?? earlier ?? crypto.randomUUID(),
    commandId: retry?.commandId ?? crypto.randomUUID(),
    earlier: earlier !== undefined,
  };
}

function sameFiles(fileIds: readonly string[], uploads: readonly AiUploadedFile[]): boolean {
  return (
    fileIds.length === uploads.length && uploads.every((upload, index) => upload.fileId === fileIds[index])
  );
}

/** Sends the turn's message with its files; its events go to `onEvent`, its outcome to `finish`. */
function sendLiveTurn(
  host: TurnHost,
  turn: LiveTurn,
  signal: AbortSignal,
  onEvent: (event: TurnEvent) => void,
  finish: (turn: LiveTurn, outcome: TurnOutcome) => void,
): void {
  void sendTurn({
    organizationId: host.organizationId,
    threadId: turn.threadId,
    commandId: turn.commandId,
    text: turn.user.text,
    fileIds: turn.uploads.map((upload) => upload.fileId),
    signal,
    onEvent,
  }).then((outcome) => finish(turn, outcome));
}

/** The one turn that runs at a time: it sends, streams the answer and puts it into its thread when it ends. */
function useLiveTurn(host: TurnHost) {
  const [live, setLive] = useState<LiveTurn | null>(null);
  // A refusal belongs to the draft its message came from, and shows only there.
  const [error, setError] = useState<{ draft: string; message: string } | null>(null);
  const liveRef = useRef<LiveTurn | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hostRef = useRef(host);
  useEffect(() => {
    hostRef.current = host;
  });
  // Leaving the page ends this client's reading; the server finishes the answer, and nothing of
  // the turn may touch the page the person went to. A message whose turn had not started by then
  // comes back into its draft when the chat opens again, as the same command.
  const leftRef = useRef(false);
  // A sign-out in the tab cleared the drafts: no answer of a turn begun before writes them again.
  // Each send takes the count anew, so a sign-out that failed and left the page blocks no next turn.
  const clears = useRef(draftClears());
  useEffect(() => {
    leftRef.current = false;
    restoreUnsent(hostRef.current);
    return () => {
      leftRef.current = true;
      abortRef.current?.abort();
    };
  }, []);

  const update = useCallback((change: (current: LiveTurn) => LiveTurn | null) => {
    liveRef.current = liveRef.current ? change(liveRef.current) : null;
    setLive(liveRef.current);
  }, []);

  const { requestStop, stop, invalidateStop } = useStop({ liveRef, leftRef, hostRef, update, setError });

  const receive = useCallback(
    (event: TurnEvent) => {
      if (leftRef.current || draftClears() !== clears.current) return;
      if (event.type === 'text') return update((turn) => ({ ...turn, answer: turn.answer + event.delta }));
      if (event.type === 'row') return placeRowOf(liveRef.current, hostRef.current, event.row);
      if (event.type === 'end')
        return update((turn) => ({ ...turn, end: { status: event.status, message: event.message ?? null } }));
      update((turn) => markStarted(turn, event, hostRef.current));
      // A stop pressed before the message was saved goes once the turn has its answer.
      const started = liveRef.current;
      if (started && started.stoppedAt !== null) requestStop(started);
    },
    [update, requestStop],
  );

  const finish = useCallback(
    (turn: LiveTurn, outcome: TurnOutcome) => {
      if (leftRef.current || liveRef.current?.commandId !== turn.commandId) return;
      const current = liveRef.current;
      abortRef.current = null;
      update(() => null);
      // The turn ends either way, so the composer takes the next message; after a sign-out's clear
      // nothing of it goes back into the drafts.
      if (draftClears() !== clears.current) return;
      releaseMessage(current.draft);
      if (current.started || outcome.kind === 'already_done')
        return settleSaved(current, outcome, hostRef.current);
      settleRefused(current, outcome, hostRef.current);
      if (outcome.kind === 'refused') setError({ draft: current.draft, message: outcome.message });
    },
    [update],
  );

  const send = useCallback(
    (text: string, draft: string, uploads: readonly AiUploadedFile[], tap = false) => {
      const host = hostRef.current;
      setError(null);
      if (liveRef.current) {
        // A message sent while an answer runs: a typed one goes back into its draft, which shows why.
        if (!tap) restoreMessage(draft, text, uploads);
        return setError({ draft, message: describeTurnRefusal('run_active') });
      }
      clears.current = draftClears();
      const { target, commandId, earlier } = commandFor(text, uploads, host, takeRetry(retryKey(draft, tap)));
      // The page loads what that thread holds. Read before the turn's stamp, a denial takes nothing off the page.
      if (earlier) void host.readWindow(target);
      invalidateStop();
      if (!tap) holdMessage({ draft, threadId: target, commandId, text }, uploads);
      host.supersedeReads(target);
      const controller = new AbortController();
      abortRef.current = controller;
      const turn = newTurn(target, commandId, text, draft, host.threadId === null, uploads, tap);
      liveRef.current = turn;
      setLive(turn);
      if (!host.threadId) host.showOnly(target);
      sendLiveTurn(host, turn, controller.signal, receive, finish);
    },
    [receive, finish, invalidateStop],
  );
  return { live, error, send, stop, draft: draftFor(host, live) };
}

/** Everything the chat page holds, from its first server render on. */
export function useKiChat(input: {
  organizationId: string;
  userId: string;
  initialThreadId: string | null;
  initialThreads: ThreadList;
  initialWindow: AiThreadWindow | null;
}) {
  const { organizationId, userId } = input;
  const list = useThreadList(organizationId, input.initialThreads);
  // A thread the person cannot open here (gone, or another organization's after Back) leaves the screen.
  const missing = useRef<(threadId: string) => void>(() => undefined);
  const { views, readWindow, reopen, settle, place, supersedeReads, receive, catchUp } = useThreadViews(
    organizationId,
    input.initialThreadId,
    input.initialWindow,
    missing,
  );
  const { threadId, shownRef, show, showOnly } = useShownThread(input.initialThreadId, reopen);
  useEffect(() => {
    missing.current = (id) => {
      list.evict(id);
      if (shownRef.current !== id) return;
      window.history.replaceState(null, '', kiThreadHref(null));
      showOnly(null);
    };
  });
  const open = useCallback(
    (id: string | null) => {
      window.history.pushState(null, '', kiThreadHref(id));
      show(id);
    },
    [show],
  );
  const turn = useLiveTurn({
    organizationId,
    userId,
    threadId,
    shownRef,
    showOnly,
    touch: list.touch,
    settle,
    place,
    readWindow,
    supersedeReads,
  });
  // A new chat's thread exists only once its message is saved; until then there is no channel to join.
  const unsaved = turn.live?.provisional === true && !turn.live.started && turn.live.threadId === threadId;
  useKiLive({ threadId: unsaved ? null : threadId, onEvent: receive, onJoin: catchUp });
  const error = turn.error?.draft === turn.draft ? turn.error.message : null;
  return { list, views, readWindow, threadId, show, openThread: open, turn, draft: turn.draft, error };
}
