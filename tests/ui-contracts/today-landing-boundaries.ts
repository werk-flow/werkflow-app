import { useSyncExternalStore } from 'react';

// Stand-in for `next/navigation` as the sign-out landing wipe sees it (today-refresh.spec.ts): the
// `(auth)` layout stays mounted while the person moves between its pages, such as from
// `/reset-password` to `/login`, and the spec moves it with `window.todayLanding.navigate`.

declare global {
  interface Window {
    todayLanding: { navigate: (pathname: string) => void };
  }
}

let current = '/reset-password';
const listeners = new Set<() => void>();
window.todayLanding = {
  navigate(pathname) {
    current = pathname;
    for (const listener of listeners) listener();
  },
};

export function usePathname(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
