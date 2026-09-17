'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Tracks whether any overlay (Dialog, AlertDialog, Sheet) is currently open.
 * `useRealtimeRouterRefresh` suspends router refreshes while one is, so a
 * Realtime event can never remount a dialog mid-interaction (the
 * "refresh-interrupted dialog" class in docs/technical/testing.md).
 *
 * The default context value is a safe no-op so the ui primitives also work
 * outside the app shell (auth, onboarding), where no Realtime refresh runs.
 */
type OpenDialogContextValue = {
  register: () => () => void;
  anyOpen: boolean;
};

const OpenDialogContext = createContext<OpenDialogContextValue>({
  register: () => () => {},
  anyOpen: false,
});

export function OpenDialogProvider({ children }: { children: ReactNode }) {
  const [openCount, setOpenCount] = useState(0);

  const register = useCallback(() => {
    setOpenCount((count) => count + 1);
    return () => setOpenCount((count) => Math.max(0, count - 1));
  }, []);

  const value = useMemo(
    () => ({ register, anyOpen: openCount > 0 }),
    [register, openCount]
  );

  return (
    <OpenDialogContext.Provider value={value}>
      {children}
    </OpenDialogContext.Provider>
  );
}

/**
 * Renders nothing; registers an open overlay while mounted. Registration lasts
 * mount-to-unmount, so place it INSIDE the Radix primitive content, which is
 * presence-gated, never in a wrapper body (DialogContent etc.) that renders
 * while the dialog is closed (that mistake suspended Realtime refresh
 * app-wide once). The primitives render it themselves; there is deliberately
 * no hook to call from elsewhere.
 */
export function RegisterOpenDialog() {
  const { register } = useContext(OpenDialogContext);
  useEffect(() => register(), [register]);
  return null;
}

export function useAnyDialogOpen(): boolean {
  return useContext(OpenDialogContext).anyOpen;
}
