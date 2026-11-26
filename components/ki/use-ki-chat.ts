'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useClientRead } from '@/hooks/use-client-read';
import type { AiThreadSummary, AiThreadWindow } from '@/lib/ai/thread-types';
import { readInBackground } from '@/lib/data/background-read-client';
import { draftKey, readDraft, writeDraft } from './ki-composer';
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
  /** The person's message: one object for the whole turn, so it never renders again while the answer streams. */
  user: TimelineMessage;
  answer: string;
  started: boolean;
  end: { status: 'complete' | 'failed' | 'cancelled'; message: string | null } | null;
};

const EMPTY_WINDOW: AiThreadWindow = { messages: [], hasOlder: false };

function userMessage(commandId: string, text: string, unconfirmed: boolean): TimelineMessage {
  return {
    key: `${commandId}:user`,
    sequence: 0,
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
    sequence: 0,
    role: 'assistant',
    status: live.end?.status ?? 'streaming',
    text: live.answer,
    failure: live.end?.message ?? null,
  };
}

/**
 * A read window joined with what the page holds. Older history goes in front,
 * each message once by its key; a fresh latest window replaces the messages
 * and keeps each unchanged message's object, so it does not render again.
 */
function mergeWindow(previous: AiThreadWindow | null, next: AiThreadWindow, older: boolean): AiThreadWindow {
  if (older) {
    const shown = new Set(previous?.messages.map((message) => message.key));
    return {
      hasOlder: next.hasOlder,
      messages: [
        ...next.messages.filter((message) => !shown.has(message.key)),
        ...(previous?.messages ?? []),
      ],
    };
  }
  const known = new Map(previous?.messages.map((message) => [message.key, message]));
  const messages = next.messages.map((message) => {
    const old = known.get(message.key);
    const same =
      old?.status === message.status && old.text === message.text && old.failure === message.failure;
    return same ? old : message;
  });
  return { hasOlder: next.hasOlder, messages };
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
  return { list, failure: older.failure, loadingMore: older.loading, loadMore, touch };
}

function useThreadViews(
  organizationId: string,
  initialThreadId: string | null,
  initialWindow: AiThreadWindow | null,
) {
  const [views, setViews] = useState<Record<string, ThreadView>>(() =>
    initialThreadId && initialWindow
      ? { [initialThreadId]: { window: initialWindow, confirmed: true, failed: false } }
      : {},
  );
  // A thread's settled turn outdates every read that started before it.
  const generations = useRef(new Map<string, number>());
  const readWindow = useCallback(
    async (id: string, beforeSequence?: number) => {
      const generation = generations.current.get(id) ?? 0;
      const result = await readInBackground('ki-thread-window', {
        organizationId,
        threadId: id,
        ...(beforeSequence ? { beforeSequence } : {}),
      });
      if (!beforeSequence && (generations.current.get(id) ?? 0) !== generation) return;
      setViews((all) => {
        const current = all[id]?.window ?? null;
        if (!result.success) return { ...all, [id]: { window: current, confirmed: false, failed: true } };
        return {
          ...all,
          [id]: {
            window: mergeWindow(current, result.window, beforeSequence !== undefined),
            confirmed: true,
            failed: false,
          },
        };
      });
    },
    [organizationId],
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
    generations.current.set(id, (generations.current.get(id) ?? 0) + 1);
    setViews((all) => {
      // A thread that just took its first message exists from now on; a known one keeps its state.
      if (turn.length === 0 && all[id]) return all;
      const window = all[id]?.window ?? EMPTY_WINDOW;
      const keys = new Set(turn.map((message) => message.key));
      const messages = [...window.messages.filter((message) => !keys.has(message.key)), ...turn];
      return { ...all, [id]: { window: { ...window, messages }, confirmed, failed: false } };
    });
  }, []);
  return { views, readWindow, reopen, settle };
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
  const open = useCallback(
    (id: string | null) => {
      window.history.pushState(null, '', kiThreadHref(id));
      show(id);
    },
    [show],
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
  return { threadId, shownRef, show, showOnly, open };
}

type TurnHost = {
  organizationId: string;
  userId: string;
  threadId: string | null;
  shownRef: React.RefObject<string | null>;
  /** Whether the thread exists for this page: one it read or saw being saved. */
  known: (threadId: string) => boolean;
  showOnly: (threadId: string | null) => void;
  touch: (threadId: string, text: string) => void;
  settle: (threadId: string, turn: readonly TimelineMessage[], confirmed: boolean) => void;
  readWindow: (threadId: string) => Promise<void>;
};

type Refused = { threadId: string; commandId: string; text: string };

function draftOf(host: TurnHost, threadId: string | null): string {
  return draftKey(host.userId, host.organizationId, threadId);
}

/** Moves the address to the thread while it is on screen; a turn of a page the person left never gets here. */
function showAddress(host: TurnHost, threadId: string): void {
  if (host.shownRef.current === threadId) window.history.replaceState(null, '', kiThreadHref(threadId));
}

/** The thread and command of a new message: a message sent again unchanged after its refusal is the same command. */
function commandFor(
  text: string,
  host: TurnHost,
  refused: Refused | undefined,
): { target: string; commandId: string } {
  const target =
    host.threadId ?? (refused && !host.known(refused.threadId) ? refused.threadId : crypto.randomUUID());
  const same = refused?.threadId === target && refused.text === text;
  return { target, commandId: same ? refused.commandId : crypto.randomUUID() };
}

/** The turn's message is saved: a new thread takes its address and its place at the top of the list. */
function markStarted(turn: LiveTurn, host: TurnHost): LiveTurn {
  showAddress(host, turn.threadId);
  host.settle(turn.threadId, [], true);
  host.touch(turn.threadId, turn.user.text);
  return { ...turn, started: true, user: userMessage(turn.commandId, turn.user.text, false) };
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

function newTurn(threadId: string, commandId: string, text: string): LiveTurn {
  return {
    threadId,
    commandId,
    user: userMessage(commandId, text, true),
    answer: '',
    started: false,
    end: null,
  };
}

/**
 * A message refused before its thread took it: its text goes back into its own
 * draft, which keeps the command for an unchanged retry. Returns that draft.
 */
function settleRefused(turn: LiveTurn, host: TurnHost, refused: Map<string, Refused>): string {
  const known = host.known(turn.threadId);
  const draft = draftOf(host, known ? turn.threadId : null);
  refused.set(draft, { threadId: turn.threadId, commandId: turn.commandId, text: turn.user.text });
  restoreDraft(draft, turn.user.text);
  if (!known && host.shownRef.current === turn.threadId) host.showOnly(null);
  return draft;
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
      update((turn) => markStarted(turn, hostRef.current));
    },
    [update],
  );

  const finish = useCallback(
    (turn: LiveTurn, outcome: TurnOutcome) => {
      if (leftRef.current || liveRef.current?.commandId !== turn.commandId) return;
      const current = liveRef.current;
      const host = hostRef.current;
      abortRef.current = null;
      update(() => null);
      if (current.started || outcome.kind === 'already_done') return settleSaved(current, outcome, host);
      const draft = settleRefused(current, host, refusedRef.current);
      if (outcome.kind === 'refused') setError({ draft, message: outcome.message });
    },
    [update],
  );

  const send = useCallback(
    (text: string) => {
      const host = hostRef.current;
      const draft = draftOf(host, host.threadId);
      setError(null);
      if (liveRef.current) {
        restoreDraft(draft, text);
        return setError({ draft, message: describeTurnRefusal('run_active') });
      }
      const { target, commandId } = commandFor(text, host, refusedRef.current.get(draft));
      refusedRef.current.delete(draft);
      const controller = new AbortController();
      abortRef.current = controller;
      const turn = newTurn(target, commandId, text);
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
  return { live, error, send, stop };
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
  const { views, readWindow, reopen, settle } = useThreadViews(
    organizationId,
    input.initialThreadId,
    input.initialWindow,
  );
  const { threadId, shownRef, show, showOnly, open } = useShownThread(input.initialThreadId, reopen);
  const known = (id: string): boolean => views[id] !== undefined;
  const turn = useLiveTurn({
    organizationId,
    userId,
    threadId,
    shownRef,
    known,
    showOnly,
    touch: list.touch,
    settle,
    readWindow,
  });
  const draft = draftKey(userId, organizationId, threadId && known(threadId) ? threadId : null);
  const error = turn.error?.draft === draft ? turn.error.message : null;
  return { list, views, readWindow, threadId, show, openThread: open, known, turn, draft, error };
}
