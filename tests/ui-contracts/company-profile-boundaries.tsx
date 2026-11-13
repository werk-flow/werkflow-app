import { useState } from 'react';

import { DocumentCompanyProfileForm } from '@/components/settings/document-company-profile-form';
import { DocumentLetterheadFiles } from '@/components/settings/document-letterhead-files';
import { DocumentSamplePreview } from '@/components/settings/document-sample-preview';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EMPTY_COMPANY_PROFILE_DETAILS, type CompanyProfileDetails } from '@/lib/company-profile/profile';

// The Dokumente settings as the page renders them, for two organizations
// whose profiles have the same version. „Organisation wechseln“ stands in for
// the route's refresh after the active organization changed, „Briefpapier
// entfernen“ for the refresh after another tab removed the first page's
// stationery, which keeps the version.
const ORGANIZATION_A = 'contract-organization-a';
const ORGANIZATION_B = 'contract-organization-b';
type ContractOrganization = typeof ORGANIZATION_A | typeof ORGANIZATION_B;
const PROFILES: Record<ContractOrganization, CompanyProfileDetails> = {
  [ORGANIZATION_A]: { ...EMPTY_COMPANY_PROFILE_DETAILS, companyName: 'Haustechnik Sonnenberg GmbH' },
  [ORGANIZATION_B]: { ...EMPTY_COMPANY_PROFILE_DETAILS, companyName: 'Haustechnik Lindenhof GmbH' },
};
const LOGO = { storagePath: `${ORGANIZATION_A}/briefpapier/contract-logo/logo`, mimeType: 'image/png' };

function useContractOrganization() {
  const [organizationId, setOrganizationId] = useState<ContractOrganization>(ORGANIZATION_A);
  const switchButton = (
    <Button type="button" onClick={() => setOrganizationId(ORGANIZATION_B)}>
      Organisation wechseln
    </Button>
  );
  return { organizationId, switchButton };
}

export function CompanyProfileContractFixture(): React.JSX.Element {
  const { organizationId, switchButton } = useContractOrganization();
  const [stationery, setStationery] = useState(true);
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        {switchButton}
        <Button type="button" onClick={() => setStationery(false)}>
          Briefpapier entfernen
        </Button>
        <DocumentCompanyProfileForm
          organizationId={organizationId}
          version={3}
          details={PROFILES[organizationId]}
          stationery={{ first: stationery, following: false }}
        />
      </main>
    </BannerProvider>
  );
}

/** The logo row and the Musterangebot: A has a logo, B has none, neither profile was saved. */
export function CompanyLetterheadContractFixture(): React.JSX.Element {
  const { organizationId, switchButton } = useContractOrganization();
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        {switchButton}
        <DocumentLetterheadFiles
          organizationId={organizationId}
          files={{
            logo: organizationId === ORGANIZATION_A ? LOGO : null,
            stationery_first: null,
            stationery_following: null,
          }}
        />
        <DocumentSamplePreview organizationId={organizationId} profileUpdatedAt={null} />
      </main>
    </BannerProvider>
  );
}
