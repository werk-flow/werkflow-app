import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';

import { ResponsibilitySettings } from '@/components/settings/responsibility-settings';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { getResponsibilitySettingsData } from '@/lib/responsibilities/server';
import { PersonnelOnboardingTemplateSettings } from '@/components/settings/personnel-onboarding-template-settings';
import { getPersonnelOnboardingTemplates } from '@/lib/personnel/onboarding-actions';
import { isManagerRole } from '@/lib/roles';
import { readSettingsSectionMembership } from '@/lib/settings/section-access';

export default async function EmployeesSettingsPage(): Promise<ReactElement> {
  const { membership } = await readSettingsSectionMembership('mitarbeiter');
  // Onboarding templates are Admin and Büro work. An employee sees only their
  // own responsibilities, so their page never asks for a read it is refused.
  const managesPeople = isManagerRole(membership.role);
  const [result, templatesResult] = await Promise.all([
    getResponsibilitySettingsData(),
    managesPeople ? getPersonnelOnboardingTemplates() : null,
  ]);
  if (!result.success) {
    if (result.error === 'not_authenticated') redirect('/login');
    if (result.error === 'no_active_org') redirect('/dashboard');
    return (
      <RegionLoadError title="Die Verantwortlichkeiten konnten nicht geladen werden">
        Die Einstellungen sind gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }

  return (
    <div className="flex flex-col">
      {templatesResult ? (
        <PersonnelOnboardingTemplateSettings
          templates={templatesResult.success ? templatesResult.data : null}
        />
      ) : null}
      <ResponsibilitySettings data={result.data} />
    </div>
  );
}
