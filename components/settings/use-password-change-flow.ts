'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { z } from '@/lib/zod';

import { useBanner } from '@/components/ui/banner';
import { useUserProfile } from '@/components/user/user-profile-context';
import { clearEmailChangeChallengeQuietly } from '@/hooks/use-sign-out';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  type PasswordWithConfirmationValues,
  translateSupabasePasswordError,
} from '@/lib/validation/password';
import { createSupabaseTransientBrowserClient } from '@/lib/supabase/transient-client';

const currentPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Bitte gib dein aktuelles Passwort ein.'),
});
export type CurrentPasswordValues = z.infer<typeof currentPasswordSchema>;
export type PasswordChangeStep = 'idle' | 'verify_current' | 'set_new';

function isCurrentPasswordError(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : '';
  const normalized = message.toLowerCase();

  if (
    normalized.includes('current password') ||
    normalized.includes('invalid login credentials') ||
    normalized.includes('invalid credentials') ||
    normalized.includes('incorrect password') ||
    normalized.includes('wrong password')
  ) {
    return true;
  }

  return false;
}

type PasswordChangeFlow = {
  step: PasswordChangeStep;
  formError: string | null;
  /** The profile e-mail the re-authentication needs could not be read; `retryEmailRead` reads it again. */
  emailUnavailable: boolean;
  retryEmailRead: () => void;
  isCurrentPasswordSubmitting: boolean;
  isForgotPasswordRedirecting: boolean;
  isPasswordSubmitting: boolean;
  currentPasswordForm: UseFormReturn<CurrentPasswordValues>;
  startFlow: () => void;
  resetFlow: () => void;
  backToVerificationStep: () => void;
  onCurrentPasswordSubmit: (event?: React.BaseSyntheticEvent) => Promise<void>;
  onPasswordSubmit: (values: PasswordWithConfirmationValues) => Promise<void>;
  handleForgotPassword: () => Promise<void>;
};

/**
 * The whole password-change state machine: re-authentication with the current
 * password, the in-memory copy of it, and the update with sign-out of other sessions.
 */
export function usePasswordChangeFlow(): PasswordChangeFlow {
  const { profile, isLoading: isEmailReading, refreshProfile } = useUserProfile();
  const emailUnavailable = !isEmailReading && !profile?.email.trim();
  const { showBanner } = useBanner();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const verificationClient = useMemo(() => createSupabaseTransientBrowserClient(), []);
  const [step, setStep] = useState<PasswordChangeStep>('idle');
  const currentPasswordRef = useRef('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isCurrentPasswordSubmitting, setIsCurrentPasswordSubmitting] = useState(false);
  const [isForgotPasswordRedirecting, setIsForgotPasswordRedirecting] = useState(false);
  const [isPasswordSubmitting, setIsPasswordSubmitting] = useState(false);

  const currentPasswordForm = useForm<CurrentPasswordValues>({
    resolver: zodResolver(currentPasswordSchema),
    defaultValues: {
      currentPassword: '',
    },
  });

  const forgotPasswordHref = profile?.email
    ? `/forgot-password?email=${encodeURIComponent(profile.email)}&source=settings`
    : '/forgot-password';

  const clearCurrentPassword = () => {
    currentPasswordRef.current = '';
  };

  function resetFlow(): void {
    setStep('idle');
    clearCurrentPassword();
    setFormError(null);
    currentPasswordForm.reset({ currentPassword: '' });
  }

  useEffect(() => clearCurrentPassword, []);

  function returnToVerificationStep(): void {
    clearCurrentPassword();
    currentPasswordForm.reset({ currentPassword: '' });
    setStep('verify_current');
  }

  const onCurrentPasswordSubmit = currentPasswordForm.handleSubmit(async (values) => {
    const email = profile?.email?.trim();

    if (!email) {
      // A failed read shows its own error with a retry above the form.
      if (isEmailReading) setFormError('Deine E-Mail-Adresse wird noch geladen. Versuche es gleich erneut.');
      return;
    }

    setIsCurrentPasswordSubmitting(true);
    setFormError(null);
    currentPasswordForm.clearErrors('currentPassword');

    try {
      const { error } = await verificationClient.auth.signInWithPassword({
        email,
        password: values.currentPassword,
      });

      if (error) {
        currentPasswordForm.setError('currentPassword', {
          type: 'manual',
          message: isCurrentPasswordError(error)
            ? 'Dein aktuelles Passwort ist nicht korrekt.'
            : translateSupabasePasswordError(error),
        });
        return;
      }

      // eslint-disable-next-line no-restricted-syntax -- the verification client holds a throwaway session; a failed local sign-out must not block the password change
      await verificationClient.auth.signOut({ scope: 'local' }).catch(() => undefined);
      currentPasswordRef.current = values.currentPassword;
      setStep('set_new');
    } catch {
      setFormError('Das aktuelle Passwort konnte nicht geprüft werden. Bitte versuche es erneut.');
    } finally {
      setIsCurrentPasswordSubmitting(false);
    }
  });

  async function onPasswordSubmit(values: PasswordWithConfirmationValues): Promise<void> {
    setIsPasswordSubmitting(true);
    setFormError(null);

    const currentPassword = currentPasswordRef.current;

    try {
      if (!currentPassword) {
        setFormError('Bitte bestätige zuerst erneut dein aktuelles Passwort.');
        returnToVerificationStep();
        return;
      }

      if (values.password === currentPassword) {
        setFormError('Das neue Passwort muss sich vom alten Passwort unterscheiden.');
        returnToVerificationStep();
        return;
      }

      const { error } = await supabase.auth.updateUser({
        current_password: currentPassword,
        password: values.password,
      });

      if (error) {
        if (isCurrentPasswordError(error)) {
          returnToVerificationStep();
          currentPasswordForm.setError('currentPassword', {
            type: 'manual',
            message: 'Dein aktuelles Passwort ist nicht korrekt.',
          });
          setFormError(null);
          return;
        }

        returnToVerificationStep();
        setFormError(translateSupabasePasswordError(error));
        return;
      }

      const { error: signOutOthersError } = await supabase.auth.signOut({
        scope: 'others',
      });

      resetFlow();
      showBanner({
        message: signOutOthersError
          ? 'Dein Passwort wurde aktualisiert. Andere Sitzungen konnten nicht automatisch abgemeldet werden.'
          : 'Dein Passwort wurde aktualisiert. Andere Sitzungen wurden abgemeldet.',
        variant: 'success',
      });
    } catch {
      setFormError('Das Passwort konnte nicht aktualisiert werden. Bitte versuche es erneut.');
    } finally {
      setIsPasswordSubmitting(false);
    }
  }

  async function handleForgotPassword(): Promise<void> {
    setFormError(null);
    setIsForgotPasswordRedirecting(true);

    await clearEmailChangeChallengeQuietly();

    // Global on purpose: a password change ends every existing session.
    const { error } = await supabase.auth.signOut({ scope: 'global' });

    if (error) {
      setFormError('Wir konnten dich nicht sicher abmelden. Bitte versuche es erneut.');
      setIsForgotPasswordRedirecting(false);
      return;
    }

    window.location.replace(forgotPasswordHref);
  }

  function startFlow(): void {
    setStep('verify_current');
  }

  function backToVerificationStep(): void {
    setFormError(null);
    returnToVerificationStep();
  }

  return {
    step,
    formError,
    emailUnavailable,
    retryEmailRead: () => void refreshProfile(),
    isCurrentPasswordSubmitting,
    isForgotPasswordRedirecting,
    isPasswordSubmitting,
    currentPasswordForm,
    startFlow,
    resetFlow,
    backToVerificationStep,
    onCurrentPasswordSubmit,
    onPasswordSubmit,
    handleForgotPassword,
  };
}
