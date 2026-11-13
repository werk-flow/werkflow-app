import type { setActiveOrgCookie as setActiveOrgCookieAction } from '@/lib/org/actions';

type CookieResult = Awaited<ReturnType<typeof setActiveOrgCookieAction>>;

let pending: { resolve: (result: CookieResult) => void; organizationId: string } | null = null;

declare global {
  interface Window {
    organizationContract: {
      cookie: string;
      writes: string[];
      navigations: string[];
      reads: Array<{ organizationId: string; cookie: string }>;
      /** The page's saves waiting for their answer, oldest first. */
      pendingSaves: Array<(saved: boolean) => void>;
      /** Saves whose code ran after their answer, shown or not. */
      answeredSaves: number;
      /** Each banner text that rendered while the spec recorded them. */
      shownBanners: string[];
      finishCookie: (success: boolean) => void;
    };
  }
}

window.organizationContract = {
  cookie: 'organization-one',
  writes: [],
  navigations: [],
  reads: [],
  pendingSaves: [],
  answeredSaves: 0,
  shownBanners: [],
  finishCookie(success): void {
    const write = pending;
    if (!write) throw new Error('No pending organization cookie write.');
    pending = null;
    if (!success) {
      write.resolve({ success: false, error: 'not_a_member' });
      return;
    }
    window.organizationContract.cookie = write.organizationId;
    write.resolve({ success: true });
  },
};

// Typed with the real action, so a change of its result fails static:typecheck here.
export const setActiveOrgCookie: typeof setActiveOrgCookieAction = async (organizationId) => {
  window.organizationContract.writes.push(organizationId);
  return new Promise<CookieResult>((resolve) => {
    pending = { resolve, organizationId };
  });
};
const router = {
  refresh(): void {
    window.organizationContract.navigations.push('refresh');
  },
  push(path: string): void {
    window.organizationContract.navigations.push(path);
  },
};
export function useRouter(): typeof router {
  return router;
}
export function usePathname(): string {
  return '/dashboard';
}

/** Counts a save whose code ran after its answer, shown or not. */
export function recordAnsweredSave(): void {
  window.organizationContract.answeredSaves += 1;
}
