// The chat page over a held turn: `sendTurn` stands in for the turn route's
// client (components/ki/turn-client.ts), so the spec decides when the message
// is saved, each batch of the answer, and how the turn ends. `useKiLive`
// stands in for the thread's live channel (components/ki/use-ki-live.ts): the
// spec sees which thread the page joined and sends its events. The thread
// reads go to `/api/background-read`, which the spec routes.
import { useEffect } from 'react';

import { KiChat } from '@/components/ki/ki-chat';
import { describeTurnRefusal, type TurnEvent, type TurnOutcome } from '@/components/ki/turn-client';
import { BannerProvider } from '@/components/ui/banner';
import type { KiLiveEvent } from '@/lib/ai/live/events';
import type { AiThreadWindow } from '@/lib/ai/thread-types';

export { describeTurnRefusal };

type HeldTurn = {
  calls: { threadId: string; commandId: string; text: string }[];
  emit: ((event: TurnEvent) => void) | null;
  resolve: ((outcome: TurnOutcome) => void) | null;
};

declare global {
  interface Window {
    uiContractKiTurn: HeldTurn;
    /** Set by the spec: every thread read fails with this code, as a lost connection or a refusal does. */
    uiContractKiReadsFail: 'background_read_failed' | 'not_found' | false;
    /** Set by the spec to a list: each thread read waits there, with its answer, until the spec releases it. */
    uiContractKiHeldReads: { threadId: unknown; release: () => void }[] | null;
    /** Set by the spec: what a listed thread's read answers, in place of an empty window. */
    uiContractKiWindows: Record<string, AiThreadWindow>;
    /** Every thread read's input, in the order the page sent them. */
    uiContractKiReadInputs: unknown[];
    /** The live channel the page joined: its thread, null for none, and what the spec sends on it. */
    uiContractKiLive: {
      threadId: string | null;
      joins: string[];
      emit: ((event: KiLiveEvent) => void) | null;
      join: (() => void) | null;
    };
  }
}

window.uiContractKiTurn = { calls: [], emit: null, resolve: null };
window.uiContractKiReadsFail = false;
window.uiContractKiHeldReads = null;
window.uiContractKiWindows = {};
window.uiContractKiReadInputs = [];
window.uiContractKiLive = { threadId: null, joins: [], emit: null, join: null };

/** The live channel's stand-in: it joins at once and hands the spec the thread's event handler. */
export function useKiLive(input: {
  threadId: string | null;
  onEvent: (threadId: string, event: KiLiveEvent) => void;
  onJoin: (threadId: string) => void;
}): void {
  const { threadId, onEvent, onJoin } = input;
  useEffect(() => {
    const live = window.uiContractKiLive;
    live.threadId = threadId;
    if (threadId === null) return;
    live.joins.push(threadId);
    live.emit = (event) => onEvent(threadId, event);
    live.join = () => onJoin(threadId);
    return () => {
      live.threadId = null;
      live.emit = null;
      live.join = null;
    };
  }, [threadId, onEvent, onJoin]);
}

/** A listed thread opens with the window the spec set, or empty: the spec drives each turn. Any other thread is not the person’s. */
function answerKiThreadWindow(threadId: unknown) {
  if (window.uiContractKiReadsFail) return { success: false, error: window.uiContractKiReadsFail };
  const listed = KI_CONTRACT_THREADS.find((thread) => thread.id === threadId);
  return listed
    ? { success: true, window: window.uiContractKiWindows[listed.id] ?? { messages: [], hasOlder: false } }
    : { success: false, error: 'not_found' };
}

export function readKiThreadWindowContract(input: unknown) {
  const threadId = input && typeof input === 'object' && 'threadId' in input ? input.threadId : null;
  window.uiContractKiReadInputs.push(input);
  const answer = answerKiThreadWindow(threadId);
  const held = window.uiContractKiHeldReads;
  if (!held) return answer;
  return new Promise((resolve) => held.push({ threadId, release: () => resolve(answer) }));
}

export function sendTurn(input: {
  threadId: string;
  commandId: string;
  text: string;
  signal: AbortSignal;
  onEvent: (event: TurnEvent) => void;
}): Promise<TurnOutcome> {
  const held = window.uiContractKiTurn;
  held.calls.push({ threadId: input.threadId, commandId: input.commandId, text: input.text });
  return new Promise((resolve) => {
    held.emit = input.onEvent;
    held.resolve = (outcome) => {
      held.emit = null;
      held.resolve = null;
      resolve(outcome);
    };
    input.signal.addEventListener('abort', () => held.resolve?.({ kind: 'stopped' }));
  });
}

export const KI_CONTRACT_THREADS = [
  {
    id: '00000000-0000-4000-8000-0000000000c1',
    title: 'Material für die Heizung',
    updatedAt: '2026-11-26T09:00:00.000Z',
  },
  { id: '00000000-0000-4000-8000-0000000000c2', title: 'Entlüften', updatedAt: '2026-11-25T09:00:00.000Z' },
];

export function KiChatContractFixture(): React.JSX.Element {
  return (
    <BannerProvider>
      <main className="flex h-dvh flex-col">
        <h1>Komponentenverträge</h1>
        <KiChat
          organizationId="00000000-0000-4000-8000-0000000000a1"
          userId="00000000-0000-4000-8000-0000000000b1"
          initialThreadId={null}
          initialThreads={{ threads: KI_CONTRACT_THREADS, hasMore: false }}
          initialWindow={null}
        />
      </main>
    </BannerProvider>
  );
}
