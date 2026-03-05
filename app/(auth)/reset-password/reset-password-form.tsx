'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { PasswordRequirements } from '@/components/password/PasswordRequirements';
import { PasswordStrengthMeter } from '@/components/password/PasswordStrengthMeter';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';
import { PasswordInput } from '@/components/ui/password-input';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  getPasswordRequirements,
  getPasswordStrengthLevel,
  passwordSchema,
  translateSupabasePasswordError
} from '@/lib/validation/password';

const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Die Passwörter stimmen nicht überein.',
    path: ['confirmPassword']
  });

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

type TokenState = 'loading' | 'valid' | 'invalid';

export function ResetPasswordForm() {
  const router = useRouter();
  // Use SSR browser client to read session from cookies (set by server-side callback)
  // This enables cross-browser and incognito password reset
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [tokenState, setTokenState] = useState<TokenState>('loading');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const isRedirectingRef = useRef(false);

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onChange',
    reValidateMode: 'onChange',
    defaultValues: {
      password: '',
      confirmPassword: ''
    }
  });

  const passwordValue =
    useWatch({
      control: form.control,
      name: 'password'
    }) ?? '';
  const passwordRequirements = useMemo(
    () => getPasswordRequirements(passwordValue),
    [passwordValue]
  );
  const passwordStrength = useMemo(
    () => getPasswordStrengthLevel(passwordValue),
    [passwordValue]
  );
  // Button is clickable when password meets requirements (not disabled by confirmation mismatch)
  const canSubmit = passwordRequirements.allMet && !isSubmitting;

  useEffect(() => {
    let hasResolvedToken = false;
    let timeoutId: NodeJS.Timeout | null = null;
    let isActive = true;

    setTokenState('loading');
    setTokenError(null);

    const resolveToken = (state: TokenState, message?: string) => {
      if (!isActive || hasResolvedToken) {
        return;
      }

      hasResolvedToken = true;
      setTokenState(state);

      if (state === 'invalid') {
        setTokenError(
          message ??
            'Der Link zum Zurücksetzen des Passworts ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.'
        );
      } else if (message) {
        setTokenError(message);
      }

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const establishSession = async () => {
      if (typeof window === 'undefined') {
        resolveToken('invalid', 'Ungültiger Link.');
        return;
      }

      const currentUrl = new URL(window.location.href);
      const error = currentUrl.searchParams.get('error');
      const errorDescription = currentUrl.searchParams.get('error_description');
      const codeParam = currentUrl.searchParams.get('code');
      const hash = window.location.hash;

      // Check for errors in query params (server-side verification errors)
      if (error) {
        console.error('Supabase auth error:', error, errorDescription);
        resolveToken(
          'invalid',
          'Der Link zum Zurücksetzen des Passworts ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.'
        );
        return;
      }

      const {
        data: { session: existingSession }
      } = await supabase.auth.getSession();

      if (existingSession?.user) {
        resolveToken('valid');
        return;
      }

      if (codeParam) {
        console.warn(
          'Received PKCE code in password reset link; the link must be opened in the original browser session.'
        );
        resolveToken(
          'invalid',
          'Der Link zum Zurücksetzen des Passworts ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.'
        );
        return;
      }

      if (!hash || hash.length <= 1) {
        resolveToken('invalid', 'Ungültiger Link.');
        return;
      }

      const params = new URLSearchParams(hash.slice(1));
      
      // Check for errors in hash fragment (Supabase returns errors this way for implicit flow)
      const hashError = params.get('error');
      const hashErrorCode = params.get('error_code');
      const hashErrorDescription = params.get('error_description');
      
      if (hashError) {
        console.error('Supabase auth error in hash:', hashError, hashErrorCode, hashErrorDescription);
        
        // Provide specific error messages based on error code
        if (hashErrorCode === 'otp_expired') {
          resolveToken(
            'invalid',
            'Der Link zum Zurücksetzen des Passworts ist abgelaufen. Links sind nur 1 Stunde gültig. Bitte fordere einen neuen Link an.'
          );
        } else if (hashErrorCode === 'otp_disabled') {
          resolveToken(
            'invalid',
            'Der Link wurde bereits verwendet. Bitte fordere einen neuen Link an.'
          );
        } else {
          resolveToken(
            'invalid',
            'Der Link zum Zurücksetzen des Passworts ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.'
          );
        }
        return;
      }

      const type = params.get('type');
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (type !== 'recovery' || !accessToken || !refreshToken) {
        resolveToken('invalid', 'Ungültiger Link.');
        return;
      }

      try {
        const { data, error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });

        if (sessionError) {
          console.error('Session setup error:', sessionError);
          resolveToken(
            'invalid',
            'Der Link zum Zurücksetzen des Passworts ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.'
          );
          return;
        }

        if (data.session?.user) {
          resolveToken('valid');
          return;
        }
      } catch (error) {
        console.error(
          'Unexpected error while establishing recovery session:',
          error
        );
        resolveToken(
          'invalid',
          'Es ist ein Fehler aufgetreten. Bitte versuche es erneut.'
        );
        return;
      }
    };

    establishSession();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event: string, session: { user?: { id: string } } | null) => {
      if (!isActive || isRedirectingRef.current || hasResolvedToken) {
        return;
      }

      if (
        event === 'PASSWORD_RECOVERY' ||
        (session?.user &&
          (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED'))
      ) {
        hasResolvedToken = true;
        setTokenState('valid');
        setTokenError(null);
      } else if (event === 'SIGNED_OUT') {
        resolveToken(
          'invalid',
          'Der Link zum Zurücksetzen des Passworts ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.'
        );
      }
    });

    timeoutId = setTimeout(() => {
      if (!hasResolvedToken) {
        resolveToken(
          'invalid',
          'Es ist ein Fehler aufgetreten. Bitte versuche es erneut.'
        );
      }
    }, 5000);

    return () => {
      isActive = false;
      subscription.unsubscribe();
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setFormError(null);
    form.clearErrors('password');

    const values = form.getValues();

    // Check if passwords match before proceeding
    if (values.password !== values.confirmPassword) {
      form.setError('confirmPassword', {
        type: 'manual',
        message: 'Die Passwörter stimmen nicht überein.'
      });
      return;
    }

    // Validate password requirements
    if (!passwordRequirements.allMet) {
      return;
    }

    setIsSubmitting(true);

    try {
      // Update the user's password
      const { error: updateError } = await supabase.auth.updateUser({
        password: values.password
      });

      if (updateError) {
        console.error('Password update error:', updateError);

        // Check for specific error types
        if (
          updateError.message?.includes('expired') ||
          updateError.message?.includes('invalid')
        ) {
          setFormError(
            'Der Link ist abgelaufen oder ungültig. Bitte fordere einen neuen Link an.'
          );
        } else {
          // Translate password errors to user-friendly German messages
          // Show via formError since the password FormMessage is hidden (we show requirements checklist instead)
          const friendly = translateSupabasePasswordError(updateError);
          setFormError(friendly);
          form.resetField('password', {
            keepDirty: false,
            keepError: false,
            defaultValue: ''
          });
          form.resetField('confirmPassword', {
            keepDirty: false,
            keepError: false,
            defaultValue: ''
          });
        }
        return;
      }

      // Mark that we're redirecting to prevent token state updates
      // Use ref instead of state to avoid closure issues in the auth listener
      isRedirectingRef.current = true;

      // Immediately sign out the user for security
      await supabase.auth.signOut();

      // Redirect to login with success message
      router.push('/login?message=password-reset-success');
    } catch (error) {
      console.error('Unexpected error:', error);
      setFormError(
        'Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es erneut.'
      );
    } finally {
      // Reset submitting state in case redirect fails or is delayed
      setIsSubmitting(false);
    }
  };

  // Loading state
  if (tokenState === 'loading') {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm text-muted-foreground">Token wird überprüft...</p>
      </div>
    );
  }

  // Invalid token state
  if (tokenState === 'invalid') {
    return (
      <div className="grid gap-4">
        <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
          {tokenError ??
            'Der Link zum Zurücksetzen des Passworts ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.'}
        </div>
        <div className="flex justify-center">
          <Button asChild>
            <Link href="/forgot-password">Neuen Link anfordern</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Valid token - show password reset form
  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Neues Passwort</FormLabel>
              <FormControl>
                <PasswordInput {...field} autoComplete="new-password" />
              </FormControl>
              <PasswordStrengthMeter
                className="mt-2"
                level={passwordStrength}
              />
              <PasswordRequirements
                className="mt-2"
                requirements={passwordRequirements}
              />
              <FormMessage aria-hidden className="hidden" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Passwort bestätigen</FormLabel>
              <FormControl>
                <PasswordInput
                  {...field}
                  autoComplete="new-password"
                  placeholder="Passwort wiederholen"
                />
              </FormControl>
              {/* Only show mismatch error after user attempts to submit */}
              {hasAttemptedSubmit && <FormMessage />}
            </FormItem>
          )}
        />

        {formError ? (
          <p className="text-sm text-destructive">{formError}</p>
        ) : null}

        <Button className="w-full" disabled={!canSubmit} type="submit">
          {isSubmitting
            ? 'Passwort wird gespeichert...'
            : 'Passwort zurücksetzen'}
        </Button>
      </form>
    </Form>
  );
}
