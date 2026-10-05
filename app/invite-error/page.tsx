import Link from 'next/link';
import { AlertCircle } from 'lucide-react';

import { maskEmail } from '@/components/auth/mask-email';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { StandaloneScreen } from '@/components/shared/standalone-screen';
import { Button } from '@/components/ui/button';
import { SignOutAndRedirectButton } from './sign-out-redirect-button';
import { describeFailure } from '@/lib/action-messages';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// The codes of the invite redemption, named by the login and verification flows in the URL.
const INVITE_ERROR_TITLES: Readonly<Partial<Record<string, string>>> = {
  admin_mismatch: 'Einladung nicht möglich',
  invalid_invite: 'Ungültige Einladung',
  invite_expired: 'Einladung abgelaufen',
  invite_cancelled: 'Einladung zurückgezogen',
  invite_already_used: 'Einladung bereits verwendet',
  too_many_attempts: 'Zu viele Versuche',
  email_mismatch: 'Falsche E-Mail-Adresse',
  redeem_failed: 'Einladung nicht eingelöst',
};

const INVITE_ERROR_DESCRIPTIONS: Readonly<Partial<Record<string, string>>> = {
  admin_mismatch:
    'Du kannst dieser Organisation nicht beitreten, da sie einem anderen Administrator gehört als deine bestehenden Organisationen.',
  invalid_invite: 'Der Einladungslink ist ungültig oder existiert nicht mehr.',
  invite_expired: 'Diese Einladung ist abgelaufen. Bitte fordere eine neue Einladung an.',
  invite_cancelled:
    'Diese Einladung wurde vom Administrator zurückgezogen. Bitte fordere eine neue Einladung an.',
  invite_already_used:
    'Diese Einladung wurde bereits von einem anderen Benutzer verwendet. Bitte fordere eine neue Einladung an.',
  too_many_attempts:
    'Du hast Einladungen zu oft in kurzer Zeit geöffnet. Bitte warte etwas und öffne den Einladungslink dann erneut.',
  email_mismatch:
    'Diese Einladung ist für eine andere E-Mail-Adresse bestimmt. Bitte melde dich ab und melde dich mit der richtigen E-Mail-Adresse an.',
  redeem_failed:
    'Du bist angemeldet, aber deine Einladung konnte gerade nicht eingelöst werden. Öffne den Einladungslink in einem Moment erneut.',
};

export default async function InviteErrorPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    email?: string;
    invite_code?: string;
  }>;
}) {
  const params = await searchParams;
  const error = params.error || '';
  const invitedEmail = params.email || '';
  const inviteCode = params.invite_code || '';

  const isEmailMismatch = error === 'email_mismatch';

  // Whether the invited address already has an account decides between login
  // and sign-up. The RPC bypasses RLS to check auth.users. Null: the check
  // failed, the page says so with a retry and offers the login.
  let isExistingUser: boolean | null = false;
  if (isEmailMismatch && invitedEmail) {
    const { data: userCheckResult, error: userCheckError } = await createSupabaseAdminClient().rpc(
      'check_user_exists_by_email',
      { p_email: invitedEmail.toLowerCase() },
    );
    if (userCheckError) {
      logError('invite_error.user_check_failed', userCheckError);
      isExistingUser = null;
    } else {
      // The RPC returns an array, get the first result
      const userCheck = Array.isArray(userCheckResult) ? userCheckResult[0] : userCheckResult;
      isExistingUser = userCheck?.user_exists === true;
    }
  }

  let errorInfo = {
    title:
      (Object.hasOwn(INVITE_ERROR_TITLES, error) ? INVITE_ERROR_TITLES[error] : undefined) ??
      'Fehler bei der Einladung',
    description: describeFailure(error, INVITE_ERROR_DESCRIPTIONS, 'Ein unbekannter Fehler ist aufgetreten.'),
  };

  // Customize the description for email mismatch to include the invited email
  if (isEmailMismatch && invitedEmail) {
    const actionText =
      isExistingUser === false
        ? 'erstelle ein Konto mit der richtigen E-Mail-Adresse'
        : 'melde dich mit der richtigen E-Mail-Adresse an';
    errorInfo = {
      ...errorInfo,
      description: `Diese Einladung ist für ${maskEmail(
        invitedEmail,
      )} bestimmt. Du bist aktuell mit einer anderen E-Mail-Adresse angemeldet. Bitte melde dich ab und ${actionText}.`,
    };
  }

  return (
    <StandaloneScreen>
      <div className="mx-auto max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertCircle className="size-12 text-destructive" />
          </div>
        </div>
        <h1 className="mb-2 text-2xl font-bold">{errorInfo.title}</h1>
        <p className="mb-8 text-muted-foreground">{errorInfo.description}</p>
        {isEmailMismatch && isExistingUser === null ? (
          <RegionLoadError className="mb-6 text-left">
            Wir konnten gerade nicht prüfen, ob es für diese E-Mail-Adresse schon ein Konto gibt. Hast du noch
            keins, wähle auf der Anmeldeseite „Registrieren“.
          </RegionLoadError>
        ) : null}

        {isEmailMismatch ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <SignOutAndRedirectButton
              inviteCode={inviteCode}
              invitedEmail={invitedEmail}
              isExistingUser={isExistingUser !== false}
            />
            <Button variant="outline" asChild>
              <Link href="/dashboard">Zum Dashboard</Link>
            </Button>
          </div>
        ) : (
          <Button asChild>
            <Link href="/dashboard">Zum Dashboard</Link>
          </Button>
        )}
      </div>
    </StandaloneScreen>
  );
}
