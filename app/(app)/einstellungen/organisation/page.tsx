import { redirect } from 'next/navigation';

import { AiSettingsCard } from '@/components/settings/ai-settings-card';
import { OrganizationSettingsForm } from '@/components/settings/organization-settings-form';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { readAiOrganizationSwitch } from '@/lib/ai/settings';
import { readOrganizationDeletionScope } from '@/lib/org/deletion-scope';
import { readSettingsSectionMembership } from '@/lib/settings/section-access';
import { getCachedMemberCount } from '@/lib/data/cached';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { formatBerlin } from '@/lib/utils';

export default async function OrganizationSettingsPage() {
  const { membership: activeMembership } = await readSettingsSectionMembership('organisation');

  const supabase = await createSupabaseServerClient();
  const isAdmin = activeMembership.role === 'admin';
  // Only an Admin may delete or switch WerkFlow KI, so only an Admin reads either.
  const [{ data: organization, error }, deletionScope, aiSwitch] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, name, unique_code, created_at')
      .eq('id', activeMembership.orgId)
      .single(),
    isAdmin ? readOrganizationDeletionScope(activeMembership.orgId) : null,
    isAdmin ? readAiOrganizationSwitch(activeMembership.orgId) : null,
  ]);
  // The reader logged a failure and cached nothing; the details show it.
  const memberCount = await getCachedMemberCount(activeMembership.orgId).catch(() => null);

  if (error && error.code !== 'PGRST116') {
    return (
      <RegionLoadError title="Die Organisation konnte nicht geladen werden">
        Die Organisationsdaten sind gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  if (!organization) redirect('/dashboard');

  const createdAtLabel = formatBerlin(organization.created_at, 'longDate');

  return (
    <OrganizationSettingsForm
      initialOrganization={{
        name: organization.name,
        uniqueCode: organization.unique_code,
        createdAtLabel,
        role: activeMembership.role,
        memberCount,
      }}
      deletionScope={deletionScope && (deletionScope.success ? deletionScope.scope : deletionScope.error)}
      aiSettings={
        aiSwitch ? <AiSettingsCard organizationId={activeMembership.orgId} state={aiSwitch} /> : null
      }
    />
  );
}
