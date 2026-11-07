'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';

import { NewPasswordFieldsForm } from '@/components/password/new-password-fields-form';
import { Button } from '@/components/ui/button';
import { untilPageLeaves, usePendingTask } from '@/hooks/use-server-action';
import { clearEmailChangeChallengeQuietly } from '@/hooks/use-sign-out';
import { logError } from '@/lib/logging';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  type PasswordWithConfirmationValues,
  translateSupabasePasswordError,
} from '@/lib/validation/password';

const INVALID_LINK_MESSAGE =
  'Der Link zum Zurücksetzen des Passworts ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.';

type TokenState = 'loading' | 'valid' | 'invalid';

// The confirmed reset link reaches this page as a session in cookies, which
// the callback wrote (app/auth/callback/route.ts). Tokens in the URL sign
// nobody in here: the browser client does not read them either.
async function establishRecoverySession(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  resolveToken: (state: TokenState, message?: string) => void,
): Promise<void> {
  // The callback refused the link.
  if (new URL(window.location.href).searchParams.has('error')) {
    resolveToken('invalid');
    return;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user) {
    resolveToken('valid');
    return;
  }
  // Opened without a confirmed link.
  resolveToken('invalid', 'Ungültiger Link.');
}

/**
 * Resolves the token state once: from the session the link left, from an auth event,
 * or as a failure after five seconds. Returns the cleanup of the effect.
 */
function watchRecoveryToken({
  supabase,
  isRedirectingRef,
  setTokenState,
  setTokenError,
}: {
  supabase: ReturnType<typeof createSupabaseBrowserClient>;
  isRedirectingRef: RefObject<boolean>;
  setTokenState: (state: TokenState) => void;
  setTokenError: (message: string | null) => void;
}): () => void {
  let hasResolvedToken = false;
  let timeoutId: NodeJS.Timeout | null = null;
  let isActive = true;

  const resolveToken = (state: TokenState, message?: string) => {
    if (!isActive || hasResolvedToken) {
      return;
    }

    hasResolvedToken = true;
    setTokenState(state);

    if (state === 'invalid') {
      setTokenError(message ?? INVALID_LINK_MESSAGE);
    } else if (message) {
      setTokenError(message);
    }

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  // A failed session read shows at once what the five-second guard below would show.
  establishRecoverySession(supabase, resolveToken).catch(() =>
    resolveToken('invalid', 'Es ist ein Fehler aufgetreten. Bitte versuche es erneut.'),
  );

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event: string, session: { user?: { id: string } } | null) => {
    if (!isActive || isRedirectingRef.current || hasResolvedToken) {
      return;
    }

    if (session?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
      hasResolvedToken = true;
      setTokenState('valid');
      setTokenError(null);
    } else if (event === 'SIGNED_OUT') {
      resolveToken('invalid', INVALID_LINK_MESSAGE);
    }
  });

  timeoutId = setTimeout(() => {
    if (!hasResolvedToken) {
      resolveToken('invalid', 'Es ist ein Fehler aufgetreten. Bitte versuche es erneut.');
    }
  }, 5000);

  return () => {
    isActive = false;
    subscription.unsubscribe();
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  };
}

/** Saves the new password, ends every session and leaves for the login page. */
async function resetPasswordAndLeave({
  supabase,
  router,
  values,
  isRedirectingRef,
  setFormError,
}: {
  supabase: ReturnType<typeof createSupabaseBrowserClient>;
  router: ReturnType<typeof useRouter>;
  values: PasswordWithConfirmationValues;
  isRedirectingRef: RefObject<boolean>;
  setFormError: (message: string | null) => void;
}): Promise<void> {
  try {
    // Update the user's password
    const { error: updateError } = await supabase.auth.updateUser({
      password: values.password,
    });

    if (updateError) {
      // Check for specific error types
      if (updateError.message?.includes('expired') || updateError.message?.includes('invalid')) {
        setFormError('Der Link ist abgelaufen oder ungültig. Bitte fordere einen neuen Link an.');
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

    await clearEmailChangeChallengeQuietly();

    // Immediately sign out the user for security — global on purpose: a
    // password reset must end every existing session.
    await supabase.auth.signOut({ scope: 'global' });

    let loginRedirectHref = '/login';

    try {
      await fetch('/auth/flash', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: 'password-reset-success',
        }),
      });
    } catch (error) {
      // The query parameter carries the message instead of the flash cookie.
      logError('auth.flash.store_failed', error);
      loginRedirectHref = '/login?message=password_reset_success';
    }

    // Redirect to login with a one-time server-side flash message
    router.push(loginRedirectHref);
    // The submit stays pending until the login page replaces this one.
    await untilPageLeaves();
  } catch {
    setFormError('Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es erneut.');
  }
}

export function ResetPasswordForm() {
  const router = useRouter();
  // Use SSR browser client to read session from cookies (set by server-side callback)
  // This enables cross-browser and incognito password reset
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [tokenState, setTokenState] = useState<TokenState>('loading');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const { run: runSubmit, isPending: isSubmitting } = usePendingTask();
  const [formError, setFormError] = useState<string | null>(null);
  const isRedirectingRef = useRef(false);

  useEffect(
    () => watchRecoveryToken({ supabase, isRedirectingRef, setTokenState, setTokenError }),
    [supabase],
  );

  const handleSubmit = async (values: PasswordWithConfirmationValues) => {
    setFormError(null);

    await runSubmit(() =>
      resetPasswordAndLeave({ supabase, router, values, isRedirectingRef, setFormError }),
    );
  };

  // Loading state
  if (tokenState === 'loading') {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm text-muted-foreground">Token wird überprüft…</p>
      </div>
    );
  }

  // Invalid token state
  if (tokenState === 'invalid') {
    return (
      <div className="grid gap-4">
        <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
          {tokenError ?? INVALID_LINK_MESSAGE}
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
      submittingLabel="Passwort wird gespeichert…"
      onSubmit={handleSubmit}
    />
  );
}
