import type { ReactNode } from 'react';

import { TodayRefreshOnStart } from '@/components/auftraege/work-pack/today-refresh-on-start';
import {
  OrganizationProvider,
  useOrganization,
  type UserOrg,
} from '@/components/organization/organization-context';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { UserProfileProvider } from '@/components/user/user-profile-context';
import { readTodayOnDevice } from '@/lib/field-sync/device/today-store';
import { clearTodayOnDevice } from '@/lib/field-sync/device/today-wipe';
import type { UserProfile } from '@/lib/profile-reference';
import './organization-service-boundaries';
import { TODAY_CONTRACT_ORGANIZATIONS, TODAY_CONTRACT_USER } from './today-refresh-world';

declare global {
  interface Window {
    todayRefreshContract: { storedOrganization: () => Promise<string | null> };
  }
}

window.todayRefreshContract = {
  storedOrganization: async () => (await readTodayOnDevice())?.snapshot.organizationId ?? null,
};

const memberships: UserOrg[] = TODAY_CONTRACT_ORGANIZATIONS.map((orgId) => ({
  orgId,
  name: `Musterbetrieb ${orgId.slice(-2)}`,
  uniqueCode: `MB${orgId.slice(-2)}`,
  role: 'employee',
  joinedAt: '2026-09-01T00:00:00Z',
}));

const profile: UserProfile = {
  id: TODAY_CONTRACT_USER,
  firstName: 'Mia',
  lastName: 'Muster',
  email: 'mia@example.com',
  avatarPath: null,
  avatarUrl: null,
};

/** The app's client contexts around a field worker's start page, as the app layout provides them. */
function FieldWorkerStartPage({
  children,
  serverProfile = profile,
}: {
  children: ReactNode;
  serverProfile?: UserProfile | null;
}): React.JSX.Element {
  return (
    <BannerProvider>
      <OrganizationProvider
        initialMemberships={memberships}
        initialActiveOrgId={TODAY_CONTRACT_ORGANIZATIONS[0]}
        initialActiveOrgCookieNeedsSync={false}
      >
        <UserProfileProvider initialProfile={serverProfile}>
          <main>
            <h1>Komponentenverträge</h1>
            <TodayRefreshOnStart />
            {children}
          </main>
        </UserProfileProvider>
      </OrganizationProvider>
    </BannerProvider>
  );
}

/** The field worker's start page refresh, whose code cannot load (today-refresh-service-boundaries.ts). */
export function TodayRefreshContractFixture(): React.JSX.Element {
  return <FieldWorkerStartPage>{null}</FieldWorkerStartPage>;
}

function SwitchToSecondOrganization(): React.JSX.Element {
  const { setActiveOrg } = useOrganization();
  return (
    <Button onClick={() => void setActiveOrg(TODAY_CONTRACT_ORGANIZATIONS[1])}>Organisation wechseln</Button>
  );
}

/** The start page's real refresh code, and the switch that moves the person to the second organization. */
export function TodayRefreshSwitchContractFixture(): React.JSX.Element {
  return (
    <FieldWorkerStartPage>
      <SwitchToSecondOrganization />
    </FieldWorkerStartPage>
  );
}

/**
 * A start page whose profile the server could not read: the person's id arrives only from the
 * browser's own read. „Abmelden“ runs the device wipe every sign-out starts with.
 */
export function TodayRefreshProfileContractFixture(): React.JSX.Element {
  return (
    <FieldWorkerStartPage serverProfile={null}>
      <Button onClick={() => void clearTodayOnDevice()}>Abmelden</Button>
    </FieldWorkerStartPage>
  );
}

function FallbackControls(): React.JSX.Element {
  const { refreshMemberships } = useOrganization();
  return (
    <>
      <Button onClick={() => void clearTodayOnDevice()}>Abmelden</Button>
      <Button onClick={() => void refreshMemberships()}>Mitgliedschaften neu laden</Button>
    </>
  );
}

/**
 * A start page during a sign-out: „Abmelden“ runs the device wipe every sign-out starts with, and
 * „Mitgliedschaften neu laden“ a membership refresh that finds the first organization gone.
 */
export function TodayRefreshFallbackContractFixture(): React.JSX.Element {
  return (
    <FieldWorkerStartPage>
      <FallbackControls />
    </FieldWorkerStartPage>
  );
}
