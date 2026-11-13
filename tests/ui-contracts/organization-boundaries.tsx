import { useEffect, useState } from 'react';
import {
  OrganizationProvider,
  useOrganization,
  type UserOrg,
} from '@/components/organization/organization-context';
import { OrganizationPageScope } from '@/components/organization/organization-page-scope';
import { BannerProvider, useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { recordAnsweredSave } from './organization-service-boundaries';

const memberships: UserOrg[] = ['organization-one', 'organization-two'].map((orgId) => ({
  orgId,
  name: orgId,
  uniqueCode: orgId,
  role: 'employee',
  joinedAt: '2026-09-01T00:00:00Z',
}));

function Consumer(): React.JSX.Element {
  const { activeOrgId, isSwitchingOrg, setActiveOrg } = useOrganization();
  useEffect(() => {
    if (activeOrgId)
      window.organizationContract.reads.push({
        organizationId: activeOrgId,
        cookie: window.organizationContract.cookie,
      });
  }, [activeOrgId]);
  return (
    <>
      <output aria-label="Aktive Organisation">{activeOrgId}</output>
      <output aria-label="Wechselstatus">{isSwitchingOrg ? 'Wird gewechselt' : 'Bereit'}</output>
      <Button disabled={isSwitchingOrg} onClick={() => void setActiveOrg('organization-two')}>
        Organisation wechseln
      </Button>
    </>
  );
}

/** Page state of one organization: a draft, and a save the spec answers after a switch. */
function ScopedDraft(): React.JSX.Element {
  const { showBanner } = useBanner();
  const [draft, setDraft] = useState('');
  const save = async (): Promise<void> => {
    const saved = await new Promise<boolean>((resolve) =>
      window.organizationContract.pendingSaves.push(resolve),
    );
    if (saved) showBanner({ variant: 'success', message: `Gespeichert: ${draft}` });
    else
      showBanner({
        variant: 'error',
        message: `Nicht gespeichert: ${draft}`,
        actionLabel: 'Erneut versuchen',
        onAction: () => undefined,
      });
    recordAnsweredSave();
  };
  return (
    <>
      <Input aria-label="Entwurf" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <Button onClick={() => void save()}>Entwurf speichern</Button>
    </>
  );
}

export function OrganizationContractFixture(): React.JSX.Element {
  const [serverOrganization, setServerOrganization] = useState('organization-one');
  return (
    <BannerProvider>
      <OrganizationProvider
        initialMemberships={memberships}
        initialActiveOrgId={serverOrganization}
        initialActiveOrgCookieNeedsSync={false}
      >
        <Consumer />
        <OrganizationPageScope organizationId={serverOrganization}>
          <ScopedDraft />
        </OrganizationPageScope>
        <Button onClick={() => setServerOrganization(window.organizationContract.cookie)}>
          Serverdaten übernehmen
        </Button>
      </OrganizationProvider>
    </BannerProvider>
  );
}
