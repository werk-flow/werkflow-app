'use client';

import { useOrganization } from '@/components/organization/organization-context';
import { useLiveView } from '@/hooks/use-live-view';

/**
 * Keeps the organization memberships fresh through the live-view discipline.
 * OrganizationProvider sits ABOVE the Realtime provider (it supplies the
 * active org id), so it cannot subscribe itself; this bridge mounts just
 * below the provider and routes `organization_members` events — and the
 * provider's focus/visibility catch-up — into `refreshMemberships`.
 * The mount read is intentional: another tab or browser context can change
 * memberships while this shell is absent, and the browser query reconciles
 * that state without coupling it to a cookie-writing Server Action or an RSC
 * refresh of the route that happened to mount the shell.
 */
export function OrganizationRealtimeBridge() {
  const { refreshMemberships } = useOrganization();

  useLiveView<null>({
    tables: ['organization_members'],
    read: async () => {
      await refreshMemberships();
      return { ok: true, data: null };
    },
  });

  return null;
}
