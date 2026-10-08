import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';

import { ResponsibilitySettings } from '@/components/settings/responsibility-settings';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { getResponsibilitySettingsData } from '@/lib/responsibilities/server';
import { PersonnelOnboardingTemplateSettings } from '@/components/settings/personnel-onboarding-template-settings';
import { getPersonnelOnboardingTemplates } from '@/lib/personnel/lifecycle-actions';

export default async function EmployeesSettingsPage(): Promise<ReactElement> {
  const [result, templatesResult] = await Promise.all([
    getResponsibilitySettingsData(),
    getPersonnelOnboardingTemplates(),
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
    <div className="flex h-full flex-col overflow-auto">
      <PersonnelOnboardingTemplateSettings
        templates={templatesResult.success ? templatesResult.data : null}
      />
      <ResponsibilitySettings data={result.data} />
    </div>
  );
}
