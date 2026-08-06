import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';

import { ResponsibilitySettings } from '@/components/settings/responsibility-settings';
import { getResponsibilitySettingsData } from '@/lib/responsibilities/server';

export default async function EmployeesSettingsPage(): Promise<ReactElement> {
  const result = await getResponsibilitySettingsData();
  if (!result.success) {
    if (result.error === 'not_authenticated') redirect('/login');
    redirect('/dashboard');
  }

  return <ResponsibilitySettings data={result.data} />;
}
