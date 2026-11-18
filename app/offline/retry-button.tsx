'use client';

import { RotateCw } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { usePendingTask } from '@/hooks/use-server-action';
import { returnToApp } from './return-to-app';

/**
 * „Erneut versuchen“ on the offline page. Before the page's script runs it is a plain form that
 * reloads the address the person opened. Once it runs, a tap shows the spinner at once, checks
 * the connection and reloads into the app, or says in place that there is still no signal. The
 * signal coming back (`online`) runs the same check. It is busy only while a check of its own
 * runs, so a later check the page makes on its own (return-on-signal.tsx) never blocks a tap.
 */
export function RetryButton() {
  const { run, isPending } = usePendingTask();
  const [noSignal, setNoSignal] = useState(false);

  const attempt = useCallback(
    () =>
      run(async () => {
        setNoSignal(!(await returnToApp()));
      }),
    [run],
  );

  useEffect(() => {
    // The signal's first check, shown here; ReturnOnSignal checks again while the connection settles.
    const onOnline = (): void => void attempt();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [attempt]);

  const retry = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setNoSignal(false);
    void attempt();
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
