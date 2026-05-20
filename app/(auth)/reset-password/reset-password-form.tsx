'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { NewPasswordFieldsForm } from '@/components/password/new-password-fields-form';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  type PasswordWithConfirmationValues,
  translateSupabasePasswordError
} from '@/lib/validation/password';

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
  const isRedirectingRef = useRef(false);

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

  const handleSubmit = async (values: PasswordWithConfirmationValues) => {
    setFormError(null);
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
          const friendly = translateSupabasePasswordError(updateError);
          setFormError(friendly);
        }
        return;
      }

      // Mark that we're redirecting to prevent token state updates
      // Use ref instead of state to avoid closure issues in the auth listener
      isRedirectingRef.current = true;

      // Immediately sign out the user for security
      await supabase.auth.signOut();

      await fetch('/auth/flash', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: 'password-reset-success'
        })
      }).catch((error) => {
        console.error('Failed to store auth flash message:', error);
      });

      // Redirect to login with a one-time server-side flash message
      router.push('/login');
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
    <NewPasswordFieldsForm
      formError={formError}
      isSubmitting={isSubmitting}
      submitLabel="Passwort zurücksetzen"
      submittingLabel="Passwort wird gespeichert..."
      onSubmit={handleSubmit}
    />
  );
}
