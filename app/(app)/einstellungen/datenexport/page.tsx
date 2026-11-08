import { OrganizationExportSection } from '@/components/settings/organization-export/organization-export-section';
import { LiveRouteRefresh } from '@/components/shared/live-route-refresh';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { readOrganizationExports } from '@/lib/org-export/reads';
import { readSettingsSectionMembership } from '@/lib/settings/section-access';

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
