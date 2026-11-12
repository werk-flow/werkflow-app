import { Activity, useEffect, useState, type ReactElement } from 'react';

import { SupportFilingForm } from '@/components/support/support-filing-form';
import { BannerProvider } from '@/components/ui/banner';
import type { SupportFilingOptions } from '@/lib/problem-reports/types';
import { useSearchParams } from './list-navigation-service-boundaries';

// Support's filing form for its contract: the real form files through the
// support action stand-ins (support-triage-boundaries.tsx) and navigates
// through the list navigation stand-ins, whose address holds the chosen
// organization. The page hides as Next.js keeps a left route with
// `cacheComponents`: inside a hidden `Activity`, with its state.

const SUPPORT_FILING_PAGE_VISIBILITY_EVENT = 'ui-contract:support-filing-visibility';

const ORGANIZATION_A = '33500000-0000-4000-8000-0000000000a1';
const ORGANIZATION_B = '33500000-0000-4000-8000-0000000000b1';
const RITA = { userId: '33500000-0000-4000-8000-000000000101', name: 'Rita Melder' };
const BEN = { userId: '33500000-0000-4000-8000-000000000102', name: 'Ben Beispiel' };

/** Rita belongs to both organizations, Ben to the first only. */
function optionsFor(organizationId: string | null): SupportFilingOptions {
  return {
    organizations: [
      { id: ORGANIZATION_A, name: 'Muster Haustechnik GmbH' },
      { id: ORGANIZATION_B, name: 'Beispiel Sanitär GmbH' },
    ],
    members:
      organizationId === ORGANIZATION_A ? [BEN, RITA] : organizationId === ORGANIZATION_B ? [RITA] : [],
  };
}

declare global {
  interface Window {
    /** The filing page is out of view, as after the navigation to a filed report. */
    uiContractSupportFilingHidden: boolean;
  }
}

window.uiContractSupportFilingHidden = false;

export function SupportFilingContractFixture(): ReactElement {
  const organizationId = useSearchParams().get('organisation');
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const adopt = (): void => setHidden(window.uiContractSupportFilingHidden);
    window.addEventListener(SUPPORT_FILING_PAGE_VISIBILITY_EVENT, adopt);
    return () => window.removeEventListener(SUPPORT_FILING_PAGE_VISIBILITY_EVENT, adopt);
  }, []);
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <Activity mode={hidden ? 'hidden' : 'visible'}>
          <SupportFilingForm options={optionsFor(organizationId)} organizationId={organizationId} />
        </Activity>
      </main>
    </BannerProvider>
  );
}
