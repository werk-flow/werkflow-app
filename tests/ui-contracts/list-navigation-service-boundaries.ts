import { startTransition, useEffect, useMemo, useState } from 'react';

const listeners = new Set<() => void>();
// Next.js commits a navigation as a transition, so a commit's passive effects
// run in a later task and a keystroke can land in between.
function notify(): void {
  startTransition(() => {
    for (const listener of listeners) listener();
  });
}
window.addEventListener('popstate', notify);
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const router = {
  push(href: string): void {
    window.listNavigationContract.requests.push(href);
  },
  replace(href: string): void {
    window.listNavigationContract.requests.push(href);
  },
};
declare global {
  interface Window {
    listNavigationContract: {
      requests: string[];
      commit: (href: string, historyNavigation?: boolean) => void;
    };
  }
}
window.listNavigationContract = {
  requests: [],
  commit(href, historyNavigation = false): void {
    window.history.replaceState({}, '', href);
    if (historyNavigation) window.dispatchEvent(new PopStateEvent('popstate'));
    else notify();
  },
};
export function useRouter(): typeof router {
  return router;
}
export function usePathname(): string {
  return window.location.pathname;
}
export function useSearchParams(): URLSearchParams {
  const [search, setSearch] = useState(() => window.location.search);
  useEffect(() => subscribe(() => setSearch(window.location.search)), []);
  return useMemo(() => new URLSearchParams(search), [search]);
}
