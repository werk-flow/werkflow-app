'use client';

import { useOrganization } from '@/components/organization/organization-context';
import { useLiveView } from '@/hooks/use-live-view';

/**
 * Keeps the organization memberships fresh through the live-view discipline.
 * OrganizationProvider sits ABOVE the Realtime provider (it supplies the
 * active org id), so it cannot subscribe itself; this bridge mounts just
 * below the provider and routes `organization_members` events — and the
 * provider's focus/visibility catch-up — into `refreshMemberships`.
 * There is no mount read: the layout render that mounted the shell just
 * produced the memberships, and the provider's join catch-up reads once the
 * channel listens, which covers a change made meanwhile in another tab.
 */
export function OrganizationRealtimeBridge() {
  const { refreshMemberships } = useOrganization();

  useLiveView<null>({
    tables: ['organization_members'],
    initialData: null,
    read: async () => {
      await refreshMemberships();
      return { ok: true, data: null };
    },
  });

  return null;
}
