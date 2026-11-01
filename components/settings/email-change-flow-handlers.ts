'use client';

import { type UseFormReturn } from 'react-hook-form';

import {
  applyResultError,
  type CompletionState,
  type NewEmailValues,
} from '@/components/settings/email-change-wizard-state';
import { type useBanner } from '@/components/ui/banner';
import {
  type requestCurrentEmailChangeOtp,
  type resetEmailChangeWizard,
  type verifyCurrentEmailChangeOtp,
} from '@/lib/settings/email-change-actions';
import { type EmailChangeWizardState } from '@/lib/settings/email-change.types';

type FlowContext = {
  emailForm: UseFormReturn<NewEmailValues>;
  currentOtpCode: string;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  setWizardState: (state: EmailChangeWizardState) => void;
  setFormError: (error: string | null) => void;
  setCompletionState: (completionState: CompletionState | null) => void;
  setCurrentOtpCode: (value: string) => void;
  setNewEmailOtpCode: (value: string) => void;
  runStart: typeof requestCurrentEmailChangeOtp;
  runVerifyCurrentOtp: typeof verifyCurrentEmailChangeOtp;
  runResendCurrentOtp: typeof requestCurrentEmailChangeOtp;
  runReset: typeof resetEmailChangeWizard;
  reportUnexpectedError: () => void;
};

type FlowHandlers = {
  handleStartFlow: () => Promise<void>;
  handleVerifyCurrentEmailCode: () => Promise<void>;
  handleResendCurrentEmailCode: () => Promise<void>;
  handleResetFlow: () => Promise<void>;
};

/**
 * The current-address half of the email-change wizard and its reset: starting
 * the flow, verifying and resending the current address's code, and cancelling.
 * Rebuilt on every render like the inline handlers it replaced, so it always
 * reads the current state.
 */
export function createFlowHandlers({
  emailForm,
  currentOtpCode,
  showBanner,
  setWizardState,
  setFormError,
  setCompletionState,
  setCurrentOtpCode,
  setNewEmailOtpCode,
  runStart,
  runVerifyCurrentOtp,
  runResendCurrentOtp,
  runReset,
  reportUnexpectedError,
}: FlowContext): FlowHandlers {
  async function handleStartFlow(): Promise<void> {
    setFormError(null);
    setCompletionState(null);
    setCurrentOtpCode('');

    try {
      const result = await runStart();
      applyResultError(result, setWizardState, setFormError);
    } catch {
      reportUnexpectedError();
    }
  }

  async function handleVerifyCurrentEmailCode(): Promise<void> {
    setFormError(null);

    if (currentOtpCode.replace(/\D/g, '').length !== 6) {
      setFormError('Bitte gib den vollständigen sechsstelligen Code ein.');
      return;
    }

    try {
      const result = await runVerifyCurrentOtp(currentOtpCode);
      applyResultError(result, setWizardState, setFormError);

      if (result.success) {
        setCurrentOtpCode('');
      }
    } catch {
      reportUnexpectedError();
    }
  }

  async function handleResendCurrentEmailCode(): Promise<void> {
    setFormError(null);

    try {
      const result = await runResendCurrentOtp();
      applyResultError(result, setWizardState, setFormError);
    } catch {
      reportUnexpectedError();
    }
  }

  async function handleResetFlow(): Promise<void> {
    setFormError(null);

    try {
      const result = await runReset();
      applyResultError(result, setWizardState, setFormError);

      if (result.success) {
        setCompletionState(null);
        setCurrentOtpCode('');
        setNewEmailOtpCode('');
        emailForm.reset({ email: '' });
        showBanner({
          message:
            'Die E-Mail-Änderung wurde abgebrochen. Deine bisherige E-Mail-Adresse bleibt unverändert.',
          variant: 'success',
        });
      }
    } catch {
      reportUnexpectedError();
    }
  }

  return { handleStartFlow, handleVerifyCurrentEmailCode, handleResendCurrentEmailCode, handleResetFlow };
}
