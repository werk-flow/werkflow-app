import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuftraegeColumnSettingsForm } from '@/components/settings/auftraege-column-settings-form';
import { getCachedMemberships, getCachedOrganizationUserPreferences, getCachedUser } from '@/lib/data/cached';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { resolveActiveOrgId } from '@/lib/org/cookies';

export default async function JobsProjectsSettingsPage() {
  const [
    {
      data: { user },
    },
    cookieStore,
  ] = await Promise.all([getCachedUser(), cookies()]);

  if (!user) {
    redirect('/login');
  }

  const memberships = await getCachedMemberships(user.id);
  const activeOrgId = await resolveActiveOrgId(cookieStore, user.id);
  const activeMembership =
    memberships.find((membership) => membership.orgId === activeOrgId) ?? memberships[0] ?? null;

  if (!activeMembership) {
    redirect('/dashboard');
  }

  // The reader logged the failure. The form is withheld: offering the defaults
  // as the saved choice would overwrite the real one on the next save.
  const preferences = await getCachedOrganizationUserPreferences(activeMembership.orgId, user.id).catch(
    () => null,
  );
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
      organizationName={activeMembership.name}
    />
  );
}
