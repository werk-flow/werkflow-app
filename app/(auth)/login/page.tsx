import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  getSupabaseServerSession,
  createSupabaseServerClient
} from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/data/cached';
import { getAuthenticatedRedirectPath } from '@/lib/auth/redirects';

import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Anmelden'
};

const SUCCESS_MESSAGES: Record<string, string> = {
  'password-reset-success':
    'Passwort erfolgreich aktualisiert. Bitte erneut einloggen.',
  'password-reset-requested':
    'Wenn eine E-Mail existiert, haben wir dir einen Link geschickt.',
  account_deleted: 'Dein Konto wurde erfolgreich gelöscht.'
};

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ message?: string; invite_code?: string }>;
}) {
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

  const successMessage = params.message
    ? SUCCESS_MESSAGES[params.message]
    : undefined;

  // If there's an invite code, validate it and get the organization name
  // Use RPC function that bypasses RLS (since user might not be authenticated)
  let organizationName: string | null = null;
  if (inviteCode) {
    const supabase = await createSupabaseServerClient();

    // Use the RPC function to look up invite by code (bypasses RLS)
    const { data: inviteData, error: inviteError } = await supabase.rpc(
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
