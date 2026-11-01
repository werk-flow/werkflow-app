'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';

import { createFlowHandlers } from '@/components/settings/email-change-flow-handlers';
import { createNewEmailStepHandlers } from '@/components/settings/email-change-new-email-step';
import {
  deriveEmailChangeTimers,
  countdownEnd,
  newEmailSchema,
  type CompletionState,
  type EmailChangeTimers,
  type NewEmailValues,
} from '@/components/settings/email-change-wizard-state';
import { useBanner } from '@/components/ui/banner';
import { useUserProfile } from '@/components/user/user-profile-context';
import { usePendingTask, useServerAction } from '@/hooks/use-server-action';
import { useWallClockTick } from '@/hooks/use-wall-clock-tick';
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

/** The pending state of every server call the wizard makes. */
function useEmailChangeTasks() {
  const { run: runStart, isPending: isStarting } = useServerAction(requestCurrentEmailChangeOtp);
  const { run: runVerifyCurrentOtp, isPending: isCurrentOtpSubmitting } =
    useServerAction(verifyCurrentEmailChangeOtp);
  const { run: runResendCurrentOtp, isPending: isCurrentOtpResending } = useServerAction(
    requestCurrentEmailChangeOtp,
  );
  const { run: runSaveNewEmail, isPending: isSavingNewEmail } = usePendingTask();
  const { run: runVerifyNewEmailOtp, isPending: isNewEmailOtpSubmitting } = usePendingTask();
  const { run: runResendNewEmailOtp, isPending: isNewEmailOtpResending } = usePendingTask();
  const { run: runReset, isPending: isResetting } = useServerAction(resetEmailChangeWizard);
  return {
    runStart,
    isStarting,
    runVerifyCurrentOtp,
    isCurrentOtpSubmitting,
    runResendCurrentOtp,
    isCurrentOtpResending,
    runSaveNewEmail,
    isSavingNewEmail,
    runVerifyNewEmailOtp,
    isNewEmailOtpSubmitting,
    runResendNewEmailOtp,
    isNewEmailOtpResending,
    runReset,
    isResetting,
  };
}

/**
 * The new-address form, and the adoption of a new server wizard state: it
 * replaces the local wizard state and resets the form.
 */
function useNewEmailForm(
  initialState: EmailChangeWizardState,
  setWizardState: (state: EmailChangeWizardState) => void,
): UseFormReturn<NewEmailValues> {
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

  return emailForm;
}

/**
 * The whole email-change state machine: server wizard state, both codes, the
 * new-address form, the one-second clock and every step transition.
 */
export function useEmailChangeWizard(initialState: EmailChangeWizardState): EmailChangeWizard {
  const { profile, refreshProfile } = useUserProfile();
  const { showBanner } = useBanner();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [wizardState, setWizardState] = useState(initialState);
  const [completionState, setCompletionState] = useState<CompletionState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [currentOtpCode, setCurrentOtpCode] = useState('');
  const [newEmailOtpCode, setNewEmailOtpCode] = useState('');
  const tasks = useEmailChangeTasks();
  const now = useWallClockTick(1000, true, countdownEnd(wizardState));
  const emailForm = useNewEmailForm(initialState, setWizardState);

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

  const stepContext = {
    ...tasks,
    emailForm,
    currentEmail,
    pendingNewEmail,
    currentOtpCode,
    newEmailOtpCode,
    supabase,
    refreshProfile,
    showBanner,
    setWizardState,
    setFormError,
    setCompletionState,
    setCurrentOtpCode,
    setNewEmailOtpCode,
    reportUnexpectedError,
  };

  return {
    wizardState,
    completionState,
    formError,
    currentOtpCode,
    setCurrentOtpCode,
    newEmailOtpCode,
    setNewEmailOtpCode,
    isStarting: tasks.isStarting,
    isCurrentOtpSubmitting: tasks.isCurrentOtpSubmitting,
    isCurrentOtpResending: tasks.isCurrentOtpResending,
    isSavingNewEmail: tasks.isSavingNewEmail,
    isNewEmailOtpSubmitting: tasks.isNewEmailOtpSubmitting,
    isNewEmailOtpResending: tasks.isNewEmailOtpResending,
    isResetting: tasks.isResetting,
    emailForm,
    currentEmail,
    pendingNewEmail,
    timers,
    dismissCompletion,
    ...createFlowHandlers(stepContext),
    ...createNewEmailStepHandlers(stepContext),
  };
}
