import { AccountSecuritySettings } from '@/components/settings/account-security-settings';
import { getInitialEmailChangeWizardState } from '@/lib/settings/email-change-state';
import type { EmailChangeWizardState } from '@/lib/settings/email-change.types';

export default async function AccountSecuritySettingsPage() {
  let initialEmailChangeState: EmailChangeWizardState = {
    step: 'idle',
    currentEmail: null,
    newEmail: null,
    currentOtpExpiresAt: null,
    currentOtpResendAvailableAt: null,
    currentEmailVerifiedExpiresAt: null,
    newEmailOtpExpiresAt: null,
    newEmailResendAvailableAt: null,
  };

  try {
    initialEmailChangeState = await getInitialEmailChangeWizardState();
  } catch (error) {
    console.error('Error loading initial email change wizard state:', error);
  }

  return (
    <AccountSecuritySettings initialEmailChangeState={initialEmailChangeState} />
  );
}
