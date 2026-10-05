'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';

import { createNewEmailStepHandlers } from '@/components/settings/email-change-new-email-step';
import {
  applyResultError,
  deriveEmailChangeTimers,
  newEmailSchema,
  type CompletionState,
  type EmailChangeTimers,
  type NewEmailValues,
} from '@/components/settings/email-change-wizard-state';
import { useBanner } from '@/components/ui/banner';
import { useUserProfile } from '@/components/user/user-profile-context';
import {
  requestCurrentEmailChangeOtp,
  resetEmailChangeWizard,
  verifyCurrentEmailChangeOtp,
} from '@/lib/settings/email-change-actions';
import { type EmailChangeWizardState } from '@/lib/settings/email-change.types';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export type EmailChangeWizard = {
  wizardState: EmailChangeWizardState;
  completionState: CompletionState | null;
  formError: string | null;
  currentOtpCode: string;
  setCurrentOtpCode: (value: string) => void;
  newEmailOtpCode: string;
  setNewEmailOtpCode: (value: string) => void;
  isStarting: boolean;
  isCurrentOtpSubmitting: boolean;
  isCurrentOtpResending: boolean;
  isSavingNewEmail: boolean;
  isNewEmailOtpSubmitting: boolean;
  isNewEmailOtpResending: boolean;
  isResetting: boolean;
  emailForm: UseFormReturn<NewEmailValues>;
  currentEmail: string;
  pendingNewEmail: string | null;
  timers: EmailChangeTimers;
  dismissCompletion: () => void;
  handleStartFlow: () => Promise<void>;
  handleVerifyCurrentEmailCode: () => Promise<void>;
  handleResendCurrentEmailCode: () => Promise<void>;
  handleSubmitNewEmail: (event?: React.BaseSyntheticEvent) => Promise<void>;
  handleResendNewEmailCode: () => Promise<void>;
  handleVerifyNewEmailCode: () => Promise<void>;
  handleResetFlow: () => Promise<void>;
};

/**
 * The whole email-change state machine: server wizard state, both codes, the
 * new-address form, the one-second clock and every step transition.
 */
export function useEmailChangeWizard(initialState: EmailChangeWizardState): EmailChangeWizard {
  const router = useRouter();
  const { profile, refreshProfile } = useUserProfile();
  const { showBanner } = useBanner();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [wizardState, setWizardState] = useState(initialState);
  const [completionState, setCompletionState] = useState<CompletionState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [currentOtpCode, setCurrentOtpCode] = useState('');
  const [newEmailOtpCode, setNewEmailOtpCode] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isCurrentOtpSubmitting, setIsCurrentOtpSubmitting] = useState(false);
  const [isCurrentOtpResending, setIsCurrentOtpResending] = useState(false);
  const [isSavingNewEmail, setIsSavingNewEmail] = useState(false);
  const [isNewEmailOtpSubmitting, setIsNewEmailOtpSubmitting] = useState(false);
  const [isNewEmailOtpResending, setIsNewEmailOtpResending] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [now, setNow] = useState(Date.now());

  const emailForm = useForm<NewEmailValues>({
    resolver: zodResolver(newEmailSchema),
    defaultValues: {
      email: initialState.newEmail ?? '',
    },
  });

  // Adopted during render, never in an effect (realtime-and-caching checklist).
  const [adoptedState, setAdoptedState] = useState(initialState);
  if (initialState !== adoptedState) {
    setAdoptedState(initialState);
    setWizardState(initialState);
  }

  useEffect(() => {
    emailForm.reset({
      email: initialState.newEmail ?? '',
    });
  }, [emailForm, initialState]);

  useEffect(() => {
    // eslint-disable-next-line no-restricted-syntax -- wall-clock render tick, no data polling
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const currentEmail = profile?.email ?? wizardState.currentEmail ?? '';
  const pendingNewEmail = wizardState.newEmail;
  const timers = deriveEmailChangeTimers(wizardState, now);

  function reportUnexpectedError(): void {
    setFormError(
      'Die E-Mail-Änderung konnte nicht vollständig verarbeitet werden. Bitte versuche es erneut.',
    );
  }

  function dismissCompletion(): void {
    setCompletionState(null);
  }

  async function handleStartFlow(): Promise<void> {
    setFormError(null);
    setCompletionState(null);
    setCurrentOtpCode('');
    setIsStarting(true);

    try {
      const result = await requestCurrentEmailChangeOtp();
      applyResultError(result, setWizardState, setFormError);
    } catch {
      reportUnexpectedError();
    } finally {
      setIsStarting(false);
    }
  }

  async function handleVerifyCurrentEmailCode(): Promise<void> {
    setFormError(null);

    if (currentOtpCode.replace(/\D/g, '').length !== 6) {
      setFormError('Bitte gib den vollständigen sechsstelligen Code ein.');
      return;
    }

    setIsCurrentOtpSubmitting(true);

    try {
      const result = await verifyCurrentEmailChangeOtp(currentOtpCode);
      applyResultError(result, setWizardState, setFormError);

      if (result.success) {
        setCurrentOtpCode('');
      }
    } catch {
      reportUnexpectedError();
    } finally {
      setIsCurrentOtpSubmitting(false);
    }
  }

  async function handleResendCurrentEmailCode(): Promise<void> {
    setFormError(null);
    setIsCurrentOtpResending(true);

    try {
      const result = await requestCurrentEmailChangeOtp();
      applyResultError(result, setWizardState, setFormError);
    } catch {
      reportUnexpectedError();
    } finally {
      setIsCurrentOtpResending(false);
    }
  }

  const { handleSubmitNewEmail, handleResendNewEmailCode, handleVerifyNewEmailCode } =
    createNewEmailStepHandlers({
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
      setIsSavingNewEmail,
      setIsNewEmailOtpResending,
      setIsNewEmailOtpSubmitting,
      reportUnexpectedError,
    });

  async function handleResetFlow(): Promise<void> {
    setFormError(null);
    setIsResetting(true);

    try {
      const result = await resetEmailChangeWizard();
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
    } finally {
      setIsResetting(false);
    }
  }

  return {
    wizardState,
    completionState,
    formError,
    currentOtpCode,
    setCurrentOtpCode,
    newEmailOtpCode,
    setNewEmailOtpCode,
    isStarting,
    isCurrentOtpSubmitting,
    isCurrentOtpResending,
    isSavingNewEmail,
    isNewEmailOtpSubmitting,
    isNewEmailOtpResending,
    isResetting,
    emailForm,
    currentEmail,
    pendingNewEmail,
    timers,
    dismissCompletion,
    handleStartFlow,
    handleVerifyCurrentEmailCode,
    handleResendCurrentEmailCode,
    handleSubmitNewEmail,
    handleResendNewEmailCode,
    handleVerifyNewEmailCode,
    handleResetFlow,
  };
}
