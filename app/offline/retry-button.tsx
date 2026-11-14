'use client';

import { RotateCw } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { usePendingTask } from '@/hooks/use-server-action';
import { returnToApp, returnWhenReachable, returnsOnStart } from './return-to-app';

/**
 * „Erneut versuchen“ on the offline page. Before the page's script runs it is a plain form that
 * reloads the address the person opened. Once it runs, a tap shows the spinner at once, checks
 * the connection and reloads into the app, or says in place that there is still no signal. The
 * signal coming back (`online`) runs the same attempt, checking again while the new connection
 * settles, and so does the page's start when the phone already reports a network.
 */
export function RetryButton() {
  const { run, isPending } = usePendingTask();
  const [noSignal, setNoSignal] = useState(false);

  const attempt = useCallback(
    (way: () => Promise<boolean>) =>
      run(async () => {
        setNoSignal(!(await way()));
      }),
    [run],
  );

  useEffect(() => {
    const onOnline = (): void => void attempt(returnWhenReachable);
    window.addEventListener('online', onOnline);
    // The signal may have come back before this listener existed; no message when the start finds none.
    if (returnsOnStart()) void run(async () => void (await returnWhenReachable()));
    return () => window.removeEventListener('online', onOnline);
  }, [attempt, run]);

  const retry = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setNoSignal(false);
    void attempt(returnToApp);
  };

  return (
    <form method="get" onSubmit={retry} className="flex flex-col items-center gap-3">
      <Button type="submit" pending={isPending}>
        <RotateCw />
        Erneut versuchen
      </Button>
      {noSignal && (
        <ErrorText>
          Immer noch kein Netz. Sobald du wieder Empfang hast, öffnet sich WerkFlow von selbst.
        </ErrorText>
      )}
    </form>
  );
}
