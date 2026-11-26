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
    /** Set by the spec: every thread read fails as a lost connection does. */
    uiContractKiReadsFail: boolean;
  }
}

window.uiContractKiTurn = { calls: [], emit: null, resolve: null };
window.uiContractKiReadsFail = false;

/** A thread opens empty: the spec drives each turn. */
export function readKiThreadWindowContract() {
  return window.uiContractKiReadsFail
    ? { success: false, error: 'background_read_failed' }
    : { success: true, window: { messages: [], hasOlder: false } };
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
