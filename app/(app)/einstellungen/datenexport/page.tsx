import dynamic from 'next/dynamic';
import { LiveRouteRefresh } from '@/components/shared/live-route-refresh';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { readOrganizationExports } from '@/lib/org-export/reads';
import { readSettingsSectionMembership } from '@/lib/settings/section-access';

// The section still renders on the server and its chunks still load with the
// page. Imported statically, its client graph made Turbopack regroup the chunks
// every route shares, and each route loaded one chunk more, the field worker's
// cold start included (audit:lab:field). Its own chunk group keeps them as
// they were.
const OrganizationExportSection = dynamic(() =>
  import('@/components/settings/organization-export/organization-export-section').then(
    (mod) => mod.OrganizationExportSection,
  ),
);

// The export's builds run as this page's Server Actions. A build's claim
// keeps the purge off its archive for fifteen minutes
// (claim_organization_export_part_build), so a build must end well before.
export const maxDuration = 300;

// Only Admin opens this section; Büro and employees go to their profile
// (lib/settings/sections.ts). Each action checks the Admin again.
export default async function DatenexportSettingsPage() {
  const { membership } = await readSettingsSectionMembership('datenexport');
  const result = await readOrganizationExports(membership.orgId);

  return (
    <div className="space-y-6">
      <LiveRouteRefresh tables={['organization_exports']} />
      {result.success ? (
        <OrganizationExportSection exports={result.exports} />
      ) : (
        <RegionLoadError title="Datenexporte konnten nicht geladen werden">
          Die Liste deiner Exporte ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
        </RegionLoadError>
      )}
    </div>
  );
}
