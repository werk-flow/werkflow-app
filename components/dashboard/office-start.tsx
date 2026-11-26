'use client';

import dynamic from 'next/dynamic';

import { useLiveAttentionOverview } from '@/components/aufgaben/use-aufgaben-overview';
import { useOrganization } from '@/components/organization/organization-context';
import { OfficeStartSkeleton } from '@/components/loading-states/office-start-skeleton';
import { OnCallNowCard } from '@/components/on-call/on-call-now-card';
import { OfficeStartView } from './office-start-sections';

// Only Admin renders it: in its own chunk, the page's client references,
// which every clock action's render sends, stay as they are for everyone else.
const OwnerStartView = dynamic(() => import('./owner-start').then((mod) => mod.OwnerStartView), {
  loading: () => <OfficeStartSkeleton />,
});

/**
 * The start page of Büro and Admin: „Bereitschaft jetzt“ as every role sees
 * it, then what needs them now (the Aufgaben sections without personnel
 * approvals, each with its count and first items). Between the two, Admin
 * sees what needs the owner's decision, from the same read. It reads in the
 * browser, because every clock action renders the dashboard's server
 * component again, and it is that render's one client component for them.
 */
export function OfficeStart() {
  const { activeOrg } = useOrganization();
  const attention = useLiveAttentionOverview();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <OnCallNowCard />
      {activeOrg?.role === 'admin' && <OwnerStartView attention={attention} />}
      <OfficeStartView attention={attention} />
    </div>
  );
}
