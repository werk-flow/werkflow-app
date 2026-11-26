'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useClientRead } from '@/hooks/use-client-read';
import type { AiThreadSummary, AiThreadWindow } from '@/lib/ai/thread-types';
import { readInBackground } from '@/lib/data/background-read-client';
import { draftKey, writeDraft } from './ki-composer';
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

/** The fresh window, keeping each unchanged message's object so it does not render again. */
function keepUnchanged(previous: AiThreadWindow | null, next: AiThreadWindow): AiThreadWindow {
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
  // The page the person asked for, by the activity time of the last thread shown.
  const [before, setBefore] = useState<string | null>(null);
  const [appended, setAppended] = useState<string | null>(null);
  const older = useClientRead({
    read: (signal) =>
      readInBackground('ki-thread-page', { organizationId, ...(before ? { before } : {}) }, signal),
    deps: [organizationId, before],
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
  const last = list.threads.at(-1)?.updatedAt ?? null;
  const loadMore = useCallback(() => setBefore(last), [last]);
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
  const readWindow = useCallback(
    async (id: string, beforeSequence?: number) => {
      const result = await readInBackground('ki-thread-window', {
        organizationId,
        threadId: id,
        ...(beforeSequence ? { beforeSequence } : {}),
      });
      setViews((all) => {
        const current = all[id]?.window ?? null;
        if (!result.success) return { ...all, [id]: { window: current, confirmed: false, failed: true } };
        const window = beforeSequence
          ? { ...result.window, messages: [...result.window.messages, ...(current?.messages ?? [])] }
          : keepUnchanged(current, result.window);
        return { ...all, [id]: { window, confirmed: true, failed: false } };
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

/** The thread and command of a new message: a message sent again after its refusal is the same command. */
function commandFor(
  text: string,
  host: TurnHost,
  refused: Refused | null,
): { target: string; commandId: string } {
  const target =
    host.threadId ?? (refused && !host.known(refused.threadId) ? refused.threadId : crypto.randomUUID());
  const same = refused?.threadId === target && refused.text === text;
  return { target, commandId: same ? refused.commandId : crypto.randomUUID() };
}

/** The turn's message is saved: a new thread takes its address and its place at the top of the list. */
function markStarted(turn: LiveTurn, host: TurnHost): LiveTurn {
  if (host.shownRef.current === turn.threadId)
    window.history.replaceState(null, '', kiThreadHref(turn.threadId));
  host.settle(turn.threadId, [], true);
  host.touch(turn.threadId, turn.user.text);
  return { ...turn, started: true, user: userMessage(turn.commandId, turn.user.text, false) };
}

/** Puts a saved turn into its thread; without its end event, the saved answer says how it went on. */
function settleSaved(current: LiveTurn, outcome: TurnOutcome, host: TurnHost): void {
  if (host.shownRef.current === current.threadId)
    window.history.replaceState(null, '', kiThreadHref(current.threadId));
  const end = current.end ?? (outcome.kind === 'already_done' ? null : endWithout(outcome));
  host.settle(current.threadId, end ? [current.user, answerMessage({ ...current, end })] : [], end !== null);
  // A stopped answer keeps what this page showed; the thread's next read shows how it went on.
  if (!current.end && outcome.kind !== 'stopped') void host.readWindow(current.threadId);
}

/** The one turn that runs at a time: it sends, streams the answer and puts it into its thread when it ends. */
function useLiveTurn(host: TurnHost) {
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const liveRef = useRef<LiveTurn | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // A message refused before it started keeps its ids, so sending it again is the same command.
  const refusedRef = useRef<Refused | null>(null);
  const hostRef = useRef(host);
  useEffect(() => {
    hostRef.current = host;
  });

  const update = useCallback((change: (current: LiveTurn) => LiveTurn | null) => {
    liveRef.current = liveRef.current ? change(liveRef.current) : null;
    setLive(liveRef.current);
  }, []);

  const receive = useCallback(
    (event: TurnEvent) => {
      if (event.type === 'text') return update((turn) => ({ ...turn, answer: turn.answer + event.delta }));
      if (event.type === 'end')
        return update((turn) => ({ ...turn, end: { status: event.status, message: event.message ?? null } }));
      update((turn) => markStarted(turn, hostRef.current));
    },
    [update],
  );

  const finish = useCallback(
    (turn: LiveTurn, outcome: TurnOutcome) => {
      if (liveRef.current?.commandId !== turn.commandId) return;
      const current = liveRef.current;
      const host = hostRef.current;
      abortRef.current = null;
      update(() => null);
      if (current.started || outcome.kind === 'already_done') return settleSaved(current, outcome, host);
      // Refused before its thread took it: the text goes back into the composer.
      const known = host.known(turn.threadId);
      refusedRef.current = { threadId: turn.threadId, commandId: turn.commandId, text: turn.user.text };
      writeDraft(draftKey(host.userId, known ? turn.threadId : null), turn.user.text);
      if (outcome.kind === 'refused') setError(outcome.message);
      if (!known && host.shownRef.current === turn.threadId) host.showOnly(null);
    },
    [update],
  );

  const send = useCallback(
    (text: string) => {
      const host = hostRef.current;
      setError(null);
      if (liveRef.current) {
        writeDraft(draftKey(host.userId, host.threadId), text);
        return setError(describeTurnRefusal('run_active'));
      }
      const { target, commandId } = commandFor(text, host, refusedRef.current);
      refusedRef.current = null;
      const controller = new AbortController();
      abortRef.current = controller;
      const turn: LiveTurn = {
        threadId: target,
        commandId,
        user: userMessage(commandId, text, true),
        answer: '',
        started: false,
        end: null,
      };
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
  const clearError = useCallback(() => setError(null), []);
  return { live, error, send, stop, clearError };
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
  const { clearError } = turn;
  const openThread = useCallback(
    (id: string | null) => {
      clearError();
      open(id);
    },
    [clearError, open],
  );
  return { list, views, readWindow, threadId, show, openThread, known, turn };
}
