import { Suspense, use, useEffect, useState } from 'react';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { ownWrites } from '@/lib/realtime/own-writes';
import { ROUTE_REFRESH_EVENT } from './lifecycle-boundaries';

declare global {
  interface Window {
    routeRefreshContract: {
      complete: (index: number, value: string) => void;
      /** Starts a save of this tab that answers when `finishSave` is called. */
      startSave: () => void;
      finishSave: (result: unknown) => void;
    };
  }
}
function Result({ value }: { value: Promise<string> | null }): React.JSX.Element {
  return <output aria-label="Serverstand">{value ? use(value) : 'vorher'}</output>;
}
function Reader(): React.JSX.Element {
  const [value, setValue] = useState<Promise<string> | null>(null);
  const [enabled, setEnabled] = useState(true);
  useRealtimeRouterRefresh({ tables: ['clients'], enabled });
  useEffect(() => {
    const completions: Array<(value: string) => void> = [];
    let answerSave: ((result: unknown) => void) | null = null;
    window.routeRefreshContract = {
      complete: (index, result) => {
        const settle = completions[index];
        if (!settle) throw new Error(`no pending route refresh read ${index}`);
        settle(result);
      },
      startSave: () => {
        void ownWrites.track(new Promise((resolve) => (answerSave = resolve)));
      },
      finishSave: (result) => {
        if (!answerSave) throw new Error('no running save');
        answerSave(result);
      },
    };
    const read = (): void => {
      setValue(new Promise<string>((resolve) => completions.push(resolve)));
    };
    window.addEventListener(ROUTE_REFRESH_EVENT, read);
    return () => window.removeEventListener(ROUTE_REFRESH_EVENT, read);
  }, []);
  return (
    <>
      <button onClick={() => setEnabled((current) => !current)}>
        {enabled ? 'Aktualisierung pausieren' : 'Aktualisierung fortsetzen'}
      </button>
      <Suspense fallback={<p>Lädt</p>}>
        <Result value={value} />
      </Suspense>
    </>
  );
}
export function RouteRefreshFixture(): React.JSX.Element {
  return (
    <RealtimeProvider>
      <Reader />
    </RealtimeProvider>
  );
}
