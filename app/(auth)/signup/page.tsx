import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { StandaloneTitle } from '@/components/shared/standalone-screen';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card';
import { TextLink } from '@/components/ui/text-link';
import { getSupabaseServerSession } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { getCachedUser } from '@/lib/data/cached';
import { getAuthenticatedRedirectPath } from '@/lib/auth/redirects';
import { isUuid } from '@/lib/validation/uuid';

import { SignupForm } from './signup-form';

export const metadata: Metadata = {
  title: 'Registrieren',
};

type SignupPageProps = {
  searchParams: Promise<{ invite_code?: string }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { session } = await getSupabaseServerSession();
  const inviteCode = (await searchParams).invite_code || '';

  // Invite codes are generated UUIDs; anything else is neither looked up nor echoed.
  if (inviteCode && !isUuid(inviteCode)) {
    redirect('/invite-error?error=invalid_invite');
  }

  // A signed-in person with an invite accepts it on the login page.
  if (session && inviteCode) {
    redirect(`/login?invite_code=${encodeURIComponent(inviteCode)}`);
  }

  if (session) {
    const {
      data: { user },
    } = await getCachedUser();
    if (user) {
      redirect(await getAuthenticatedRedirectPath(user.id));
    }
  }

  // If there's an invite code, validate it exists and is still valid
  // Use RPC function that bypasses RLS (since user isn't authenticated yet)
  let organizationName: string | null = null;
  let invitedEmail: string | null = null;
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

    // If invite is cancelled, redirect to error page immediately
    // Don't let the user sign up with a cancelled invite
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

    // If invite was already accepted, redirect to error page
    if (invite.status === 'accepted') {
      redirect('/invite-error?error=invite_already_used');
    }

    // The invite row names the address: the invite link carries only the code,
    // so the address stays out of every URL. It prefills and locks the field.
    invitedEmail = invite.email;

    // Get org name for display
    organizationName = invite.org_name || null;
  }

  return (
    <Card>
      <CardHeader>
        <StandaloneTitle>
          {organizationName ? `Tritt ${organizationName} bei` : 'Erstelle dein Konto'}
        </StandaloneTitle>
        <CardDescription>
          {organizationName
            ? `Du wurdest eingeladen, ${organizationName} beizutreten. Erstelle dein Konto, um fortzufahren.`
            : 'Werde Teil von WerkFlow und verwalte deine Arbeitsbereiche nahtlos.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm inviteCode={inviteCode} invitedEmail={invitedEmail} />
      </CardContent>
      <CardFooter className="flex justify-center">
        <p className="text-sm text-muted-foreground">
          Bereits ein Konto?{' '}
          <TextLink href={inviteCode ? `/login?invite_code=${encodeURIComponent(inviteCode)}` : '/login'}>
            Anmelden
          </TextLink>
        </p>
      </CardFooter>
    </Card>
  );
}
