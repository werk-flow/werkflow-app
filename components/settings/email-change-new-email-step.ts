'use client';

import { type useRouter } from 'next/navigation';
import { type UseFormReturn } from 'react-hook-form';

import {
  applyResultError,
  normalizeEmail,
  type CompletionState,
  type NewEmailValues,
} from '@/components/settings/email-change-wizard-state';
import { type useBanner } from '@/components/ui/banner';
import { type usePendingTask } from '@/hooks/use-server-action';
import {
  savePendingNewEmailVerification,
  touchPendingNewEmailVerification,
  verifyNewEmailChangeOtp,
} from '@/lib/settings/email-change-actions';
import { type EmailChangeWizardState } from '@/lib/settings/email-change.types';
import { type createSupabaseBrowserClient } from '@/lib/supabase/client';

/** The `run` of one `usePendingTask` owned by the wizard hook. */
type PendingTaskRunner = ReturnType<typeof usePendingTask>['run'];

type NewEmailStepContext = {
  emailForm: UseFormReturn<NewEmailValues>;
  currentEmail: string;
  pendingNewEmail: string | null;
  newEmailOtpCode: string;
  supabase: ReturnType<typeof createSupabaseBrowserClient>;
  router: ReturnType<typeof useRouter>;
  refreshProfile: () => Promise<void>;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  setWizardState: (state: EmailChangeWizardState) => void;
  setFormError: (error: string | null) => void;
  setCompletionState: (completionState: CompletionState | null) => void;
  setCurrentOtpCode: (value: string) => void;
  setNewEmailOtpCode: (value: string) => void;
  runSaveNewEmail: PendingTaskRunner;
  runResendNewEmailOtp: PendingTaskRunner;
  runVerifyNewEmailOtp: PendingTaskRunner;
  reportUnexpectedError: () => void;
};

type NewEmailStepHandlers = {
  handleSubmitNewEmail: (event?: React.BaseSyntheticEvent) => Promise<void>;
  handleResendNewEmailCode: () => Promise<void>;
  handleVerifyNewEmailCode: () => Promise<void>;
};

/**
 * The new-address half of the email-change wizard: saving the new address,
 * resending its code and verifying it. Rebuilt on every render like the
 * inline handlers it replaced, so it always reads the current state.
 */
export function createNewEmailStepHandlers({
  emailForm,
  currentEmail,
  pendingNewEmail,
  newEmailOtpCode,
  supabase,
  router,
  refreshProfile,
  showBanner,
  setWizardState,
  setFormError,
  setCompletionState,
  setCurrentOtpCode,
  setNewEmailOtpCode,
  runSaveNewEmail,
  runResendNewEmailOtp,
  runVerifyNewEmailOtp,
  reportUnexpectedError,
}: NewEmailStepContext): NewEmailStepHandlers {
  const handleSubmitNewEmail = emailForm.handleSubmit(async (values) => {
    const nextEmail = normalizeEmail(values.email);
    const activeEmail = normalizeEmail(currentEmail);

    if (nextEmail === activeEmail) {
      emailForm.setError('email', {
        type: 'manual',
        message: 'Bitte gib eine andere E-Mail-Adresse ein als die aktuell hinterlegte.',
      });
      return;
    }

    setFormError(null);

    await runSaveNewEmail(async () => {
      try {
        const result = await savePendingNewEmailVerification(nextEmail);
        applyResultError(result, setWizardState, setFormError);

        if (result.success) {
          emailForm.reset({ email: nextEmail });
        }
      } catch {
        reportUnexpectedError();
      }
    });
  });

  async function handleResendNewEmailCode(): Promise<void> {
    if (!pendingNewEmail) {
      return;
    }

    setFormError(null);

    await runResendNewEmailOtp(async () => {
      try {
        const result = await touchPendingNewEmailVerification(pendingNewEmail);
        applyResultError(result, setWizardState, setFormError);
      } catch {
        reportUnexpectedError();
      }
    });
  }

  async function handleVerifyNewEmailCode(): Promise<void> {
    if (!pendingNewEmail) {
      setFormError('Es ist keine neue E-Mail-Adresse zum Bestätigen vorhanden.');
      return;
    }

    const sanitizedCode = newEmailOtpCode.replace(/\D/g, '');
    if (sanitizedCode.length !== 6) {
      setFormError('Bitte gib den vollständigen sechsstelligen Code ein.');
      return;
    }

    setFormError(null);

    await runVerifyNewEmailOtp(async () => {
      try {
        const previousEmail = currentEmail;
        const result = await verifyNewEmailChangeOtp(sanitizedCode);
        applyResultError(result, setWizardState, setFormError);

        if (!result.success) {
          return;
        }

        const { data, error } = await supabase.auth.refreshSession();
        if (error) {
          setFormError(
            'Die E-Mail-Adresse wurde aktualisiert, aber die Sitzung konnte nicht sofort aktualisiert werden. Bitte lade die Seite neu.',
          );
        }

        if (data.session) {
          await fetch('/auth/callback', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              event: 'TOKEN_REFRESHED',
              session: data.session,
            }),
          });
        }
        await refreshProfile();
        router.refresh();
        setCompletionState({
          previousEmail,
          newEmail: pendingNewEmail,
        });
        setCurrentOtpCode('');
        setNewEmailOtpCode('');
        showBanner({
          message: 'Deine E-Mail-Adresse wurde erfolgreich aktualisiert.',
          variant: 'success',
        });
      } catch {
        reportUnexpectedError();
      }
    });
  }

  return { handleSubmitNewEmail, handleResendNewEmailCode, handleVerifyNewEmailCode };
}
