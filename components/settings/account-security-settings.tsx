'use client';

import { EmailChangeCard } from '@/components/settings/email-change-card';
import { PasswordChangeCard } from '@/components/settings/password-change-card';
import { type EmailChangeWizardState } from '@/lib/settings/email-change.types';

type AccountSecuritySettingsProps = {
  initialEmailChangeState: EmailChangeWizardState;
};

export function AccountSecuritySettings({
  initialEmailChangeState,
}: AccountSecuritySettingsProps) {
  return (
    <div className="space-y-6 pb-28">
      <EmailChangeCard initialState={initialEmailChangeState} />
      <PasswordChangeCard />
    </div>
  );
}
