import { OrganizationExportSection } from '@/components/settings/organization-export/organization-export-section';
import { BannerProvider } from '@/components/ui/banner';
import { CONTRACT_PART_IDS } from './organization-export-service-boundaries';

const [dataPart, filePart] = CONTRACT_PART_IDS;

/** The Datenexport section with one export whose two parts are not built yet. */
export function OrganizationExportContractFixture(): React.JSX.Element {
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <OrganizationExportSection
          exports={[
            {
              id: 'contract-export',
              requestedAt: '2026-11-08T09:00:00.000Z',
              fileCount: 2,
              fileBytes: 2048,
              parts: [
                {
                  id: dataPart,
                  partNumber: 1,
                  kind: 'data',
                  state: 'pending',
                  fileCount: 0,
                  fileBytes: 0,
                  expiresAt: null,
                  failureReason: null,
                },
                {
                  id: filePart,
                  partNumber: 2,
                  kind: 'files',
                  state: 'pending',
                  fileCount: 2,
                  fileBytes: 2048,
                  expiresAt: null,
                  failureReason: null,
                },
              ],
            },
          ]}
        />
      </main>
    </BannerProvider>
  );
}
