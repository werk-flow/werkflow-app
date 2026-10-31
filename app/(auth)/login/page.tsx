import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthFlashCleanup } from '@/components/auth/auth-flash-cleanup';
import { StandaloneTitle } from '@/components/shared/standalone-screen';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card';
import { TextLink } from '@/components/ui/text-link';
import { getSupabaseServerSession } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { AUTH_FLASH_COOKIE, getAuthFlashMessage, isAuthFlashKey } from '@/lib/auth/flash';
import { getCachedUser } from '@/lib/data/cached';
import { getAuthenticatedRedirectPath } from '@/lib/auth/redirects';
import { isUuid } from '@/lib/validation/uuid';
import type { Database } from '@/lib/supabase/database.types';

import { AcceptInviteButton } from './accept-invite-button';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Anmelden',
};

const SUCCESS_MESSAGES: Record<string, string> = {
  account_deleted: 'Dein Konto wurde erfolgreich gelöscht.',
  password_reset_success:
    'Dein Passwort wurde erfolgreich zurückgesetzt. Bitte melde dich mit deinem neuen Passwort an.',
};

type InviteLookupRow = Database['public']['Functions']['get_invite_by_code']['Returns'][number];

/** The confirmation above the form: the flash cookie first, then a known `message` parameter. */
function loginSuccessMessage(
  flashMessage: string | undefined,
  message: string | undefined,
): string | undefined {
  return (
    flashMessage ??
    (message && isAuthFlashKey(message)
      ? getAuthFlashMessage(message)
      : message && message in SUCCESS_MESSAGES
        ? SUCCESS_MESSAGES[message]
        : undefined)
  );
}

/** Leaves for the invite error page when the invite is cancelled or expired, by status or by date. */
function redirectUnusableInvite(invite: Pick<InviteLookupRow, 'status' | 'expires_at'>): void {
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
}

function AcceptInviteCard({
  organizationName,
  inviteCode,
}: {
  organizationName: string | null;
  inviteCode: string;
}) {
  return (
    <Card>
      <CardHeader>
        <StandaloneTitle>
          {organizationName ? `Tritt ${organizationName} bei` : 'Einladung annehmen'}
        </StandaloneTitle>
        <CardDescription>
          {organizationName
            ? `Du bist schon angemeldet. Nimm die Einladung an, um der Organisation ${organizationName} beizutreten.`
            : 'Du bist schon angemeldet. Nimm die Einladung an, um der Organisation beizutreten.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AcceptInviteButton inviteCode={inviteCode} />
      </CardContent>
    </Card>
  );
}

function LoginCard({
  organizationName,
  flashMessage,
  successMessage,
  inviteCode,
}: {
  organizationName: string | null;
  flashMessage: string | undefined;
  successMessage: string | undefined;
  inviteCode: string;
}) {
  return (
    <Card>
      <CardHeader>
        <StandaloneTitle>
          {organizationName ? `Tritt ${organizationName} bei` : 'Willkommen zurück'}
        </StandaloneTitle>
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
          <TextLink href={inviteCode ? `/signup?invite_code=${encodeURIComponent(inviteCode)}` : '/signup'}>
            Registrieren
          </TextLink>
        </p>
      </CardFooter>
    </Card>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; invite_code?: string }>;
}) {
  const { session } = await getSupabaseServerSession();
  const params = await searchParams;
  const inviteCode = params.invite_code || '';

  // Invite codes are generated UUIDs; anything else is neither looked up nor echoed.
  if (inviteCode && !isUuid(inviteCode)) {
    redirect('/invite-error?error=invalid_invite');
  }

  // A signed-in person with an invite accepts it below with a click; without
  // an invite the login page is not theirs.
  let signedInForInvite = false;
  if (session) {
    const {
      data: { user },
    } = await getCachedUser();
    if (user && !inviteCode) {
      redirect(await getAuthenticatedRedirectPath(user.id));
    }
    signedInForInvite = user !== null;
  }

  const cookieStore = await cookies();
  const authFlash = cookieStore.get(AUTH_FLASH_COOKIE)?.value;
  const flashMessage = isAuthFlashKey(authFlash) ? getAuthFlashMessage(authFlash) : undefined;
  const successMessage = loginSuccessMessage(flashMessage, params.message);

  // If there's an invite code, validate it and get the organization name
  // Use RPC function that bypasses RLS (since user might not be authenticated)
  let organizationName: string | null = null;
  if (inviteCode) {
    // Use the RPC function to look up invite by code (bypasses RLS)
    const { data: inviteData, error: inviteError } = await createSupabaseAdminClient().rpc(
      'get_invite_by_code',
      { p_invite_code: inviteCode },
    );

    // The RPC returns an array, get the first result
    const invite = Array.isArray(inviteData) ? inviteData[0] : inviteData;

    // A failed lookup is not an invalid invite: the link may well be valid.
    if (inviteError) {
      logReadFailure('Invite lookup failed', { code: inviteError.code });
      return (
        <RegionLoadError title="Die Einladung konnte nicht geprüft werden">
          Der Einladungslink ist gerade nicht prüfbar. Versuche es in einem Moment erneut.
        </RegionLoadError>
      );
    }

    // If invite doesn't exist, redirect to error page
    if (!invite) {
      redirect('/invite-error?error=invalid_invite');
    }

    redirectUnusableInvite(invite);

    // Note: We don't redirect for 'accepted' status here because
    // the user might be the one who accepted it and is just logging in again.
    // The RPC will handle the already_member case gracefully.

    // Get org name for display
    organizationName = invite.org_name || null;
  }

  if (signedInForInvite) {
    return <AcceptInviteCard organizationName={organizationName} inviteCode={inviteCode} />;
  }

  return (
    <LoginCard
      organizationName={organizationName}
      flashMessage={flashMessage}
      successMessage={successMessage}
      inviteCode={inviteCode}
    />
  );
}
