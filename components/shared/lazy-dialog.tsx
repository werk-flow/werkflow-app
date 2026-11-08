'use client';

import { useEffect, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { useBanner } from '@/components/ui/banner';

type DialogOpenProps = { open: boolean; onOpenChange: (open: boolean) => void };

type LoadState<P> = { status: 'idle' | 'loading' } | { status: 'loaded'; component: ComponentType<P> };

const IDLE = { status: 'idle' } as const;

const LOAD_FAILED_MESSAGE =
  'Das Formular konnte nicht geladen werden. Prüfe deine Verbindung und versuche es erneut.';

export type LazyDialog<P extends DialogOpenProps> = {
  /** Starts the download on the opener's intent (hover, focus, press, an opened menu). */
  preload: () => void;
  /** Renders nothing until the module arrived, then the dialog itself, and keeps it mounted. */
  Dialog: (props: P) => ReactNode;
  /** True while an open dialog waits for its download. */
  useWaiting: (open: boolean) => boolean;
};

/**
 * A dialog only some roles open, loaded on its opener's intent or on first open,
 * so a role that never opens it never downloads it (`lab.field.cold-start`).
 * A failed download closes the dialog with an error banner; the next open retries.
 */
export function lazyDialog<P extends DialogOpenProps>(load: () => Promise<ComponentType<P>>): LazyDialog<P> {
  let state: LoadState<P> = IDLE;
  let download: Promise<ComponentType<P>> | null = null;
  const listeners = new Set<() => void>();

  function update(next: LoadState<P>): void {
    state = next;
    for (const listener of listeners) listener();
  }

  function start(): Promise<ComponentType<P>> {
    if (!download) {
      update({ status: 'loading' });
      download = load().then(
        (component) => {
          update({ status: 'loaded', component });
          return component;
        },
        (error: unknown) => {
          download = null;
          update(IDLE);
          throw error;
        },
      );
    }
    return download;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // The server and the hydrating client never hold the module: a closed dialog renders nothing.
  function useLoadState(): LoadState<P> {
    return useSyncExternalStore(
      subscribe,
      () => state,
      () => IDLE,
    );
  }

  function Dialog(props: P): ReactNode {
    const current = useLoadState();
    const { showBanner } = useBanner();
    const { open, onOpenChange } = props;

    useEffect(() => {
      if (!open || state.status === 'loaded') return;
      let waiting = true;
      start().catch(() => {
        if (!waiting) return;
        onOpenChange(false);
        showBanner({ variant: 'error', message: LOAD_FAILED_MESSAGE });
      });
      return () => {
        waiting = false;
      };
    }, [open, onOpenChange, showBanner]);

    if (current.status !== 'loaded') return null;
    const Loaded = current.component;
    return <Loaded {...props} />;
  }

  function useWaiting(open: boolean): boolean {
    const current = useLoadState();
    return open && current.status === 'loading';
  }

  return {
    preload: () => {
      // eslint-disable-next-line no-restricted-syntax -- an intent download that fails costs nothing yet: the open that needs the dialog retries it and reports the failure
      start().catch(() => undefined);
    },
    Dialog,
    useWaiting,
  };
}
