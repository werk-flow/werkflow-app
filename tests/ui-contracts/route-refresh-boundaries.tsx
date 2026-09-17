import { Suspense, use, useEffect, useState } from 'react';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { ROUTE_REFRESH_EVENT } from './lifecycle-boundaries';

declare global {
  interface Window {
    routeRefreshContract: { complete: (index: number, value: string) => void };
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
    window.routeRefreshContract = { complete: (index, result) => {
      const settle = completions[index];
      if (!settle) throw new Error(`no pending route refresh read ${index}`);
      settle(result);
    } };
    const read = (): void => {
      setValue(new Promise<string>(resolve => completions.push(resolve)));
    };
    window.addEventListener(ROUTE_REFRESH_EVENT, read);
    return () => window.removeEventListener(ROUTE_REFRESH_EVENT, read);
  }, []);
  return <>
    <button onClick={() => setEnabled(current => !current)}>{enabled ? 'Aktualisierung pausieren' : 'Aktualisierung fortsetzen'}</button>
    <Suspense fallback={<p>Lädt</p>}><Result value={value} /></Suspense>
  </>;
}
export function RouteRefreshFixture(): React.JSX.Element {
  return <RealtimeProvider><Reader /></RealtimeProvider>;
}
