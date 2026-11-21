'use client';

import type { ReactElement } from 'react';

import { OrgInfoCard } from '@/components/dashboard/org-info-card';
import { OnCallNowCard } from '@/components/on-call/on-call-now-card';

/**
 * The dashboard's cards under one client boundary: the server render that
 * every clock action repeats then names one client component, not one per card.
 */
export function DashboardCards({ initialMemberCount }: { initialMemberCount: number | null }): ReactElement {
  return (
    <>
      <OnCallNowCard />
      <OrgInfoCard initialMemberCount={initialMemberCount} />
    </>
  );
}
