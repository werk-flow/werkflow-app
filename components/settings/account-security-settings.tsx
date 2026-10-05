'use client';

import { RegionLoadError } from '@/components/shared/region-load-error';
import { EmailChangeCard } from '@/components/settings/email-change-card';
import { PasswordChangeCard } from '@/components/settings/password-change-card';
import { type EmailChangeWizardState } from '@/lib/settings/email-change.types';

type AccountSecuritySettingsProps = {
  /** Null when the e-mail change state could not be read. */
  initialEmailChangeState: EmailChangeWizardState | null;
};

export function AccountSecuritySettings({ initialEmailChangeState }: AccountSecuritySettingsProps) {
  return (
    <div className="space-y-6">
      {initialEmailChangeState ? (
        <EmailChangeCard initialState={initialEmailChangeState} />
      ) : (
        <RegionLoadError title="E-Mail-Adresse">
          Der Stand deiner E-Mail-Änderung konnte nicht geladen werden.
        </RegionLoadError>
      )}
      <PasswordChangeCard />
    </div>
  );
}
