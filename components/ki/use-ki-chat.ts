'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useClientRead } from '@/hooks/use-client-read';
import type { AiThreadSummary, AiThreadWindow } from '@/lib/ai/thread-types';
import { readInBackground } from '@/lib/data/background-read-client';
import { draftKey, readDraft, writeDraft } from '@/lib/ai/chat-drafts';
import { kiThreadHref } from './ki-thread-list';
import type { TimelineMessage } from './ki-timeline';
import { describeTurnRefusal, sendTurn, type TurnEvent, type TurnOutcome } from './turn-client';

// The chat page's state (werk-flow/werkflow-planning#530): the thread list,
// the threads read so far, the thread on screen and the one running turn.
// A switch changes the address through the history API, shows the last known
// messages at once and reads the thread again (brief non-negotiables 1 and 8).
// The live channel (KI-6) and prefetch (KI-11) build on `readWindow`.

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
  answer: string;
  /** The answer's sequence in its thread, from the moment the message is saved. */
  answerSequence: number;
  started: boolean;
  end: { status: 'complete' | 'failed' | 'cancelled'; message: string | null } | null;
};

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

export function answerMessage(live: LiveTurn): TimelineMessage {
  return {
    key: `${live.commandId}:assistant`,
    sequence: live.answerSequence,
    role: 'assistant',
    status: live.end?.status ?? 'streaming',
    text: live.answer,
    failure: live.end?.message ?? null,
  };
}

function sameMessage(left: TimelineMessage, right: TimelineMessage): boolean {
  return (
    left.sequence === right.sequence &&
    left.status === right.status &&
    left.text === right.text &&
    left.failure === right.failure
  );
}

/**
 * A read window joined with what the page holds, each message once by its key
 * and in sequence order. A read never takes back a finished answer for an
 * older snapshot of it still being written, and keeps the messages it did not
 * cover: turns settled after the read began, and older pages already shown
 * when they reach the window without a gap. An
 * unchanged message keeps its object, so it does not render again.
 */
function mergeWindow(previous: AiThreadWindow | null, next: AiThreadWindow): AiThreadWindow {
  const held = new Map(previous?.messages.map((message) => [message.key, message]));
  const read = new Set(next.messages.map((message) => message.key));
  const first = Math.min(...next.messages.map((message) => message.sequence));
  const fresh = next.messages.map((message) => {
    const old = held.get(message.key);
    if (!old) return message;
    const outdated = message.status === 'streaming' && old.status !== 'streaming';
    return outdated || sameMessage(old, message) ? old : message;
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

/** How a started turn ended when its end event never arrived. */
function endWithout(outcome: TurnOutcome): NonNullable<LiveTurn['end']> {
  return outcome.kind === 'stopped'
    ? { status: 'cancelled', message: 'Du hast die Antwort angehalten.' }
    : {
        status: 'failed',
        message: 'Die Verbindung ist abgebrochen. Was schon geschrieben war, bleibt gespeichert.',
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
  // A read that answers after the page is gone touches neither its state nor the address.
  const reads = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    reads.current = controller;
    return () => controller.abort();
  }, []);
  // Each thread's stamp moves on with every read and every turn sent to it.
  const stamps = useRef(new Map<string, number>());
  const stamp = useCallback((id: string): number => {
    const next = (stamps.current.get(id) ?? 0) + 1;
    stamps.current.set(id, next);
    return next;
  }, []);
  const readWindow = useCallback(
    async (id: string, beforeSequence?: number): Promise<WindowRead> => {
      const signal = reads.current.signal;
      const mine = stamp(id);
      const result = await readInBackground(
        'ki-thread-window',
        { organizationId, threadId: id, ...(beforeSequence ? { beforeSequence } : {}) },
        signal,
      );
      if (signal.aborted) return 'failed';
      if (!result.success && DENIED_READS.has(result.error)) {
        // A newer read or turn of the thread has the last word: a retry may have saved it since.
        if (stamps.current.get(id) !== mine) return 'failed';
        setViews((all) => Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)));
        missing.current(id);
        return 'missing';
      }
      setViews((all) => {
        const current = all[id]?.window ?? null;
        // A passing failure keeps what was shown, still marked unconfirmed.
        if (!result.success) return { ...all, [id]: { window: current, confirmed: false, failed: true } };
        return {
          ...all,
          [id]: { window: mergeWindow(current, result.window), confirmed: true, failed: false },
        };
      });
      return result.success ? 'found' : 'failed';
    },
    [organizationId, missing, stamp],
  );
  /** Shows the last known messages, marked unconfirmed, and reads the thread again. */
  const reopen = useCallback(
    (id: string) => {
      setViews((all) => {
        const current = all[id];
        return current ? { ...all, [id]: { ...current, confirmed: false, failed: false } } : all;
      });
      void readWindow(id);
    },
    [readWindow],
  );
  /** Puts a turn's messages into its thread, in place of earlier copies under the same keys. */
  const settle = useCallback((id: string, turn: readonly TimelineMessage[], confirmed: boolean) => {
    setViews((all) => {
      // A thread that just took its first message exists from now on; a known one keeps its state.
      if (turn.length === 0 && all[id]) return all;
      const window = all[id]?.window ?? EMPTY_WINDOW;
      const keys = new Set(turn.map((message) => message.key));
      const messages = [...window.messages.filter((message) => !keys.has(message.key)), ...turn];
      return { ...all, [id]: { window: { ...window, messages }, confirmed, failed: false } };
    });
  }, []);
  return { views, readWindow, reopen, settle, supersedeReads: stamp };
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
  readWindow: (threadId: string) => Promise<WindowRead>;
  /** A turn sent to the thread: no denied read that began before it may take the thread off the page. */
  supersedeReads: (threadId: string) => void;
};

type Refused = { threadId: string; commandId: string; text: string };

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
  if (turn.provisional && host.shownRef.current === turn.threadId) {
    const typed = readDraft(turn.draft);
    const destination = draftKey(host.userId, host.organizationId, turn.threadId);
    const held = readDraft(destination);
    writeDraft(turn.draft, '');
    if (typed) writeDraft(destination, held ? `${held}\n\n${typed}` : typed);
  }
  showAddress(host, turn.threadId);
  host.settle(turn.threadId, [], true);
  host.touch(turn.threadId, turn.user.text);
  const user = userMessage(turn.commandId, turn.user.text, event.userItem.sequence, false);
  return { ...turn, started: true, user, answerSequence: event.assistantItem.sequence };
}

/** Puts a saved turn into its thread and the list; without its end event, the saved answer says how it went on. */
function settleSaved(current: LiveTurn, outcome: TurnOutcome, host: TurnHost): void {
  showAddress(host, current.threadId);
  host.touch(current.threadId, current.user.text);
  const end = current.end ?? (outcome.kind === 'already_done' ? null : endWithout(outcome));
  host.settle(current.threadId, end ? [current.user, answerMessage({ ...current, end })] : [], end !== null);
  // A stopped answer keeps what this page showed; the thread's next read shows how it went on.
  if (!current.end && outcome.kind !== 'stopped') void host.readWindow(current.threadId);
}

/** The text of a refused message goes back into its own draft, before what was typed there meanwhile. */
function restoreDraft(key: string, text: string): void {
  const typed = readDraft(key);
  writeDraft(key, typed ? `${text}\n\n${typed}` : text);
}

function newTurn(
  threadId: string,
  commandId: string,
  text: string,
  draft: string,
  provisional: boolean,
): LiveTurn {
  const user = userMessage(commandId, text, 0, true);
  return {
    threadId,
    commandId,
    draft,
    provisional,
    user,
    answer: '',
    answerSequence: 0,
    started: false,
    end: null,
  };
}

/**
 * A message refused before its turn started: its text goes back into its own
 * draft, which keeps the command for an unchanged retry. The route may have
 * saved the message before it refused, so the thread is read again, and a new
 * thread that exists after all joins the list.
 */
function settleRefused(turn: LiveTurn, host: TurnHost, refused: Map<string, Refused>): void {
  refused.set(turn.draft, { threadId: turn.threadId, commandId: turn.commandId, text: turn.user.text });
  restoreDraft(turn.draft, turn.user.text);
  if (turn.provisional && host.shownRef.current === turn.threadId) host.showOnly(null);
  void host.readWindow(turn.threadId).then((read) => {
    if (read === 'found') host.touch(turn.threadId, turn.user.text);
  });
}

/**
 * The thread and command of a message. Only a message sent again unchanged
 * after its refusal is the same command in the same thread; other text from
 * the new chat starts a new thread.
 */
function commandFor(
  text: string,
  host: TurnHost,
  refused: Refused | undefined,
): { target: string; commandId: string } {
  const retry =
    refused?.text === text && (host.threadId === null || host.threadId === refused.threadId)
      ? refused
      : undefined;
  return {
    target: host.threadId ?? retry?.threadId ?? crypto.randomUUID(),
    commandId: retry?.commandId ?? crypto.randomUUID(),
  };
}

/** The one turn that runs at a time: it sends, streams the answer and puts it into its thread when it ends. */
function useLiveTurn(host: TurnHost) {
  const [live, setLive] = useState<LiveTurn | null>(null);
  // A refusal belongs to the draft its message came from, and shows only there.
  const [error, setError] = useState<{ draft: string; message: string } | null>(null);
  const liveRef = useRef<LiveTurn | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const refusedRef = useRef(new Map<string, Refused>());
  const hostRef = useRef(host);
  useEffect(() => {
    hostRef.current = host;
  });
  // Leaving the page ends this client's reading; the server finishes the answer, and nothing of
  // the turn may touch the page the person went to.
  const leftRef = useRef(false);
  useEffect(() => {
    leftRef.current = false;
    return () => {
      leftRef.current = true;
      abortRef.current?.abort();
    };
  }, []);

  const update = useCallback((change: (current: LiveTurn) => LiveTurn | null) => {
    liveRef.current = liveRef.current ? change(liveRef.current) : null;
    setLive(liveRef.current);
  }, []);

  const receive = useCallback(
    (event: TurnEvent) => {
      if (leftRef.current) return;
      if (event.type === 'text') return update((turn) => ({ ...turn, answer: turn.answer + event.delta }));
      if (event.type === 'end')
        return update((turn) => ({ ...turn, end: { status: event.status, message: event.message ?? null } }));
      update((turn) => markStarted(turn, event, hostRef.current));
    },
    [update],
  );

  const finish = useCallback(
    (turn: LiveTurn, outcome: TurnOutcome) => {
      if (leftRef.current || liveRef.current?.commandId !== turn.commandId) return;
      const current = liveRef.current;
      abortRef.current = null;
      update(() => null);
      if (current.started || outcome.kind === 'already_done')
        return settleSaved(current, outcome, hostRef.current);
      settleRefused(current, hostRef.current, refusedRef.current);
      if (outcome.kind === 'refused') setError({ draft: current.draft, message: outcome.message });
    },
    [update],
  );

  const send = useCallback(
    (text: string, draft: string) => {
      const host = hostRef.current;
      setError(null);
      if (liveRef.current) {
        restoreDraft(draft, text);
        return setError({ draft, message: describeTurnRefusal('run_active') });
      }
      const { target, commandId } = commandFor(text, host, refusedRef.current.get(draft));
      refusedRef.current.delete(draft);
      host.supersedeReads(target);
      const controller = new AbortController();
      abortRef.current = controller;
      const turn = newTurn(target, commandId, text, draft, host.threadId === null);
      liveRef.current = turn;
      setLive(turn);
      if (!host.threadId) host.showOnly(target);
      void sendTurn({
        organizationId: host.organizationId,
        threadId: target,
        commandId,
        text,
        signal: controller.signal,
        onEvent: receive,
      }).then((outcome) => finish(turn, outcome));
    },
    [receive, finish],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
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
  const { views, readWindow, reopen, settle, supersedeReads } = useThreadViews(
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
    readWindow,
    supersedeReads,
  });
  const error = turn.error?.draft === turn.draft ? turn.error.message : null;
  return { list, views, readWindow, threadId, show, openThread: open, turn, draft: turn.draft, error };
}
