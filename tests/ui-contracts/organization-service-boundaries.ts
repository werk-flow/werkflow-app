let pending: { resolve: () => void; reject: (error: Error) => void; organizationId: string } | null = null;

declare global {
  interface Window {
    organizationContract: {
      cookie: string;
      writes: string[];
      navigations: string[];
      reads: Array<{ organizationId: string; cookie: string }>;
      finishCookie: (success: boolean) => void;
    };
  }
}

window.organizationContract = {
  cookie: 'organization-one', writes: [], navigations: [], reads: [],
  finishCookie(success): void {
    const write = pending;
    if (!write) throw new Error('No pending organization cookie write.');
    pending = null;
    if (!success) { write.reject(new Error('not_a_member')); return; }
    window.organizationContract.cookie = write.organizationId;
    write.resolve();
  },
};

export async function setActiveOrgCookie(organizationId: string): Promise<void> {
  window.organizationContract.writes.push(organizationId);
  await new Promise<void>((resolve, reject) => { pending = { resolve, reject, organizationId }; });
}
const router = {
  refresh(): void { window.organizationContract.navigations.push('refresh'); },
  push(path: string): void { window.organizationContract.navigations.push(path); },
};
export function useRouter(): typeof router { return router; }
export function usePathname(): string { return '/dashboard'; }
