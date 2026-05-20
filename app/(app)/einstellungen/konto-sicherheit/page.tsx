import { AccountSecuritySettings } from '@/components/settings/account-security-settings';
import { getInitialEmailChangeWizardState } from '@/lib/settings/email-change-state';

export default async function AccountSecuritySettingsPage() {
  const initialEmailChangeState = await getInitialEmailChangeWizardState();

  return (
    <AccountSecuritySettings initialEmailChangeState={initialEmailChangeState} />
  );
}
