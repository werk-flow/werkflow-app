// The chat page over a held turn: `sendTurn` stands in for the turn route's
// client (components/ki/turn-client.ts), so the spec decides when the message
// is saved, each batch of the answer, and how the turn ends. The thread reads
// go to `/api/background-read`, which the spec routes.
import { KiChat } from '@/components/ki/ki-chat';
import { describeTurnRefusal, type TurnEvent, type TurnOutcome } from '@/components/ki/turn-client';
import { BannerProvider } from '@/components/ui/banner';

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
  }
}

window.uiContractKiTurn = { calls: [], emit: null, resolve: null };
window.uiContractKiReadsFail = false;
window.uiContractKiHeldReads = null;

/** A listed thread opens empty: the spec drives each turn. Any other thread is not the person's. */
function answerKiThreadWindow(threadId: unknown) {
  if (window.uiContractKiReadsFail) return { success: false, error: window.uiContractKiReadsFail };
  return KI_CONTRACT_THREADS.some((thread) => thread.id === threadId)
    ? { success: true, window: { messages: [], hasOlder: false } }
    : { success: false, error: 'not_found' };
}

export function readKiThreadWindowContract(input: unknown) {
  const threadId = input && typeof input === 'object' && 'threadId' in input ? input.threadId : null;
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
