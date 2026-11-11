import { useState, type ReactNode } from 'react';

import { TodayRefreshOnStart } from '@/components/auftraege/work-pack/today-refresh-on-start';
import { TodayLandingWipe } from '@/components/auth/today-landing-wipe';
import {
  OrganizationProvider,
  useOrganization,
  type UserOrg,
} from '@/components/organization/organization-context';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { UserProfileProvider } from '@/components/user/user-profile-context';
import { readTodayOnDevice, saveTodayOnDevice } from '@/lib/field-sync/device/today-store';
import { claimToday } from '@/lib/field-sync/device/today-sync';
import { clearTodayOnDevice } from '@/lib/field-sync/device/today-wipe';
import type { UserProfile } from '@/lib/profile-reference';
import './organization-service-boundaries';
import { TODAY_CONTRACT_ORGANIZATIONS, TODAY_CONTRACT_USER } from './today-refresh-world';

declare global {
  interface Window {
    todayRefreshContract: {
      storedOrganization: () => Promise<string | null>;
      /** Claims and stores an empty day of the organization, as a start page in another tab would. */
      storeDay: (organizationId: string) => Promise<void>;
    };
  }
}

window.todayRefreshContract = {
  storedOrganization: async () => (await readTodayOnDevice())?.snapshot.organizationId ?? null,
  storeDay: async (organizationId) => {
    const now = new Date();
    claimToday({ userId: TODAY_CONTRACT_USER, organizationId });
    await saveTodayOnDevice(
      {
        version: `day-of-${organizationId}`,
        berlinDate: '2026-11-09',
        validUntil: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        userId: TODAY_CONTRACT_USER,
        organizationId,
        assignments: [],
      },
      now,
    );
  },
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

/** The page a sign-out lands on once its session ended, mounted when „Zur Anmeldung“ is pressed. */
function SignOutLanding(): React.JSX.Element {
  const [landed, setLanded] = useState(false);
  return landed ? <TodayLandingWipe /> : <Button onClick={() => setLanded(true)}>Zur Anmeldung</Button>;
}

/**
 * The start page's real refresh code, the switch that moves the person to the second organization,
 * and the landing page of a sign-out.
 */
export function TodayRefreshSwitchContractFixture(): React.JSX.Element {
  return (
    <FieldWorkerStartPage>
      <SwitchToSecondOrganization />
      <SignOutLanding />
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
