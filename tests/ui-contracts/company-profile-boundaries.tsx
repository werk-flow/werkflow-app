import { useState } from 'react';

import { DocumentCompanyProfileForm } from '@/components/settings/document-company-profile-form';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EMPTY_COMPANY_PROFILE_DETAILS } from '@/lib/company-profile/profile';

// The company details form as the settings page renders it, for two
// organizations whose profiles have the same version and first-page
// stationery. The switch stands in for the route's refresh after the active
// organization changed.
const PROFILES = {
  'contract-organization-a': { ...EMPTY_COMPANY_PROFILE_DETAILS, companyName: 'Haustechnik Sonnenberg GmbH' },
  'contract-organization-b': { ...EMPTY_COMPANY_PROFILE_DETAILS, companyName: 'Haustechnik Lindenhof GmbH' },
} as const;

export function CompanyProfileContractFixture(): React.JSX.Element {
  const [organizationId, setOrganizationId] = useState<keyof typeof PROFILES>('contract-organization-a');
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <Button type="button" onClick={() => setOrganizationId('contract-organization-b')}>
          Organisation wechseln
        </Button>
        <DocumentCompanyProfileForm
          organizationId={organizationId}
          version={3}
          details={PROFILES[organizationId]}
          stationery={{ first: true, following: false }}
        />
      </main>
    </BannerProvider>
  );
}
