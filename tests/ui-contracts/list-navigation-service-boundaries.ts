import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
function notify(): void { for (const listener of listeners) listener(); }
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => { listeners.delete(listener); window.removeEventListener('popstate', listener); };
}
const router = { replace(href: string): void { window.listNavigationContract.requests.push(href); } };
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
export function useRouter(): typeof router { return router; }
export function usePathname(): string { return window.location.pathname; }
export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  return new URLSearchParams(search);
}
