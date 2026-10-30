import { AuftraegeColumnSettingsForm } from '@/components/settings/auftraege-column-settings-form';
import { getCachedOrganizationUserPreferences } from '@/lib/data/cached';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { readSettingsSectionMembership } from '@/lib/settings/section-access';

export default async function JobsProjectsSettingsPage() {
  const { userId, membership } = await readSettingsSectionMembership('auftraege-projekte');

  // The reader logged the failure. The form is withheld: offering the defaults
  // as the saved choice would overwrite the real one on the next save.
  const preferences = await getCachedOrganizationUserPreferences(membership.orgId, userId).catch(() => null);
  if (!preferences) {
    return (
      <RegionLoadError title="Spalten konnten nicht geladen werden">
        Deine gespeicherte Spaltenauswahl ist gerade nicht erreichbar. Versuche es erneut.
      </RegionLoadError>
    );
  }

  return (
    <AuftraegeColumnSettingsForm
      initialVisibleColumns={preferences.visibleColumns}
      organizationName={membership.name}
    />
  );
}
