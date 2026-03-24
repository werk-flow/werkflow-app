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

import { SignupForm } from './signup-form';

export const metadata: Metadata = {
  title: 'Registrieren'
};

type SignupPageProps = {
  searchParams: Promise<{ email?: string; invite_code?: string }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { session } = await getSupabaseServerSession();
  const params = await searchParams;
  const prefillEmail = params.email || '';
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

  // If there's an invite code, validate it exists and is still valid
  // Use RPC function that bypasses RLS (since user isn't authenticated yet)
  let organizationName: string | null = null;
  let invitedEmail: string | null = null;
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

    // Store the invited email for validation
    invitedEmail = invite.email;

    // Get org name for display
    organizationName = invite.org_name || null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          {organizationName
            ? `Tritt ${organizationName} bei`
            : 'Erstelle dein Konto'}
        </CardTitle>
        <CardDescription>
          {organizationName
            ? `Du wurdest eingeladen, ${organizationName} beizutreten. Erstelle dein Konto, um fortzufahren.`
            : 'Werde Teil von WerkFlow und verwalte deine Arbeitsbereiche nahtlos.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm
          prefillEmail={prefillEmail}
          inviteCode={inviteCode}
          invitedEmail={invitedEmail}
        />
      </CardContent>
      <CardFooter className="flex justify-center">
        <p className="text-sm text-muted-foreground">
          Bereits ein Konto?{' '}
          <Link
            href={inviteCode ? `/login?invite_code=${inviteCode}` : '/login'}
            className="text-primary underline-offset-4 hover:underline"
          >
            Anmelden
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
