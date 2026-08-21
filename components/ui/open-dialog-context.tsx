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
 * Call from a component that only mounts while its overlay is open.
 * Registration lasts mount-to-unmount.
 *
 * Caution: the shared wrapper components (DialogContent etc.) render their
 * hooks whenever they are in the React tree, even while the dialog is closed —
 * only the Radix primitive content inside them is presence-gated. Register via
 * <RegisterOpenDialog /> placed INSIDE the primitive content, never from the
 * wrapper body (that mistake suspended Realtime refresh app-wide once).
 */
export function useRegisterOpenDialog(): void {
  const { register } = useContext(OpenDialogContext);
  useEffect(() => register(), [register]);
}

/** Renders nothing; registers an open overlay while mounted. */
export function RegisterOpenDialog() {
  useRegisterOpenDialog();
  return null;
}

export function useAnyDialogOpen(): boolean {
  return useContext(OpenDialogContext).anyOpen;
}
