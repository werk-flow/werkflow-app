import { useEffect, useState } from 'react';
import { OrganizationProvider, useOrganization, type UserOrg } from '@/components/organization/organization-context';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import './organization-service-boundaries';

const memberships: UserOrg[] = ['organization-one', 'organization-two'].map((orgId) => ({ orgId, name: orgId, uniqueCode: orgId, role: 'employee', joinedAt: '2026-09-01T00:00:00Z' }));

function Consumer(): React.JSX.Element {
  const { activeOrgId, isSwitchingOrg, setActiveOrg } = useOrganization();
  useEffect(() => {
    if (activeOrgId) window.organizationContract.reads.push({ organizationId: activeOrgId, cookie: window.organizationContract.cookie });
  }, [activeOrgId]);
  return <>
    <output aria-label="Aktive Organisation">{activeOrgId}</output>
    <output aria-label="Wechselstatus">{isSwitchingOrg ? 'Wird gewechselt' : 'Bereit'}</output>
    <Button disabled={isSwitchingOrg} onClick={() => void setActiveOrg('organization-two')}>Organisation wechseln</Button>
  </>;
}

export function OrganizationContractFixture(): React.JSX.Element {
  const [serverOrganization, setServerOrganization] = useState('organization-one');
  return <BannerProvider><OrganizationProvider initialMemberships={memberships} initialActiveOrgId={serverOrganization}
    initialActiveOrgCookieNeedsSync={false} initialIsSubscribed>
    <Consumer />
    <Button onClick={() => setServerOrganization(window.organizationContract.cookie)}>Serverdaten übernehmen</Button>
  </OrganizationProvider></BannerProvider>;
}
