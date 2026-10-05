import { unstable_rethrow } from 'next/navigation';

import { AccountSecuritySettings } from '@/components/settings/account-security-settings';
import { logError } from '@/lib/logging';
import { getInitialEmailChangeWizardState } from '@/lib/settings/email-change-state';
import type { EmailChangeWizardState } from '@/lib/settings/email-change.types';

export default async function AccountSecuritySettingsPage() {
  // Null: the state could not be read. The card shows the failure with a
  // retry instead of an idle wizard that hides a change in progress.
  let initialEmailChangeState: EmailChangeWizardState | null = null;

  try {
    initialEmailChangeState = await getInitialEmailChangeWizardState({ failOnReadError: true });
  } catch (error) {
    unstable_rethrow(error);
    logError('settings.email_change_state.read_failed', error);
  }

  return <AccountSecuritySettings initialEmailChangeState={initialEmailChangeState} />;
}
