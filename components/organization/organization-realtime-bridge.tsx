'use client';

import { useOrganization } from '@/components/organization/organization-context';
import { useLiveView } from '@/hooks/use-live-view';

/**
 * Keeps the organization memberships fresh through the live-view discipline.
 * OrganizationProvider sits ABOVE the Realtime provider (it supplies the
 * active org id), so it cannot subscribe itself; this bridge mounts just
 * below the provider and routes `organization_members` events — and the
 * provider's focus/visibility catch-up — into `refreshMemberships`.
 * `initialData` suppresses the mount read: the server render that mounted
 * the app shell already produced current memberships.
 */
export function OrganizationRealtimeBridge() {
  const { refreshMemberships } = useOrganization();

  useLiveView<null>({
    tables: ['organization_members'],
    read: async () => {
      await refreshMemberships();
      return { ok: true, data: null };
    },
    initialData: null,
  });

  return null;
}
