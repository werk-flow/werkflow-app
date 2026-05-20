import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthFlashCleanup } from '@/components/auth/auth-flash-cleanup';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { getSupabaseServerSession } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { AUTH_FLASH_COOKIE, getAuthFlashMessage, isAuthFlashKey } from '@/lib/auth/flash';
import { getCachedUser } from '@/lib/data/cached';
import { getAuthenticatedRedirectPath } from '@/lib/auth/redirects';
import { reportAuthUsersStringColumnHealth } from '@/lib/supabase/auth-health';

import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Anmelden'
};

const SUCCESS_MESSAGES: Record<string, string> = {
  account_deleted: 'Dein Konto wurde erfolgreich gelöscht.'
};

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ message?: string; invite_code?: string }>;
}) {
  await reportAuthUsersStringColumnHealth('login-page');

  const { session } = await getSupabaseServerSession();
  const params = await searchParams;
  const inviteCode = params.invite_code || '';

  // If user is already logged in and there's an invite code,
  // redirect to auth/callback to process the invite
  if (session && inviteCode) {
    redirect(`/auth/callback?invite_code=${inviteCode}`);
  }

  if (session) {
    const { data: { user } } = await getCachedUser();
    if (user) {
      redirect(await getAuthenticatedRedirectPath(user.id));
    }
  }

  const cookieStore = await cookies();
  const authFlash = cookieStore.get(AUTH_FLASH_COOKIE)?.value;
  const flashMessage = isAuthFlashKey(authFlash)
    ? getAuthFlashMessage(authFlash)
    : undefined;
  const successMessage =
    flashMessage ??
    (params.message === 'account_deleted'
      ? SUCCESS_MESSAGES.account_deleted
      : undefined);

  // If there's an invite code, validate it and get the organization name
  // Use RPC function that bypasses RLS (since user might not be authenticated)
  let organizationName: string | null = null;
  if (inviteCode) {
    // Use the RPC function to look up invite by code (bypasses RLS)
    const { data: inviteData, error: inviteError } = await createSupabaseAdminClient().rpc(
      'get_invite_by_code',
      { p_invite_code: inviteCode }
    );

    // The RPC returns an array, get the first result
    const invite = Array.isArray(inviteData) ? inviteData[0] : inviteData;

    // If invite doesn't exist, redirect to error page
    if (inviteError || !invite) {
      redirect('/invite-error?error=invalid_invite');
    }

    // If invite is cancelled, redirect to error page immediately
    if (invite.status === 'cancelled') {
      redirect('/invite-error?error=invite_cancelled');
    }

    // If invite is expired (by status or by date), redirect to error page
    if (invite.status === 'expired') {
      redirect('/invite-error?error=invite_expired');
    }

    // Check if invite has expired by date
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      redirect('/invite-error?error=invite_expired');
    }

    // Note: We don't redirect for 'accepted' status here because
    // the user might be the one who accepted it and is just logging in again.
    // The RPC will handle the already_member case gracefully.

    // Get org name for display
    organizationName = invite.org_name || null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          {organizationName
            ? `Tritt ${organizationName} bei`
            : 'Willkommen zurück'}
        </CardTitle>
        <CardDescription>
          {organizationName
            ? `Melde dich an, um der Organisation ${organizationName} beizutreten.`
            : 'Melde dich mit deiner E-Mail-Adresse und deinem Passwort an, um auf deinen Arbeitsbereich zuzugreifen.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {flashMessage ? <AuthFlashCleanup /> : null}
        <LoginForm successMessage={successMessage} inviteCode={inviteCode} />
      </CardContent>
      <CardFooter className="flex justify-center">
        <p className="text-sm text-muted-foreground">
          Noch kein Konto?{' '}
          <Link
            href={inviteCode ? `/signup?invite_code=${inviteCode}` : '/signup'}
            className="text-primary underline-offset-4 hover:underline"
          >
            Registrieren
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
