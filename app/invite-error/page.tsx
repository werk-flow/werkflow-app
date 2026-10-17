import Link from 'next/link';
import { cookies } from 'next/headers';
import { AlertCircle } from 'lucide-react';

import { StandaloneScreen, StandaloneTitle } from '@/components/shared/standalone-screen';
import { Button } from '@/components/ui/button';
import { SignOutAndRedirectButton } from './sign-out-redirect-button';
import { describeFailure } from '@/lib/action-messages';
import { INVITE_MISMATCH_COOKIE } from '@/lib/invites/redemption-refusal';
import { isUuid } from '@/lib/validation/uuid';

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

// The email_mismatch sentence names no address and does not say whether the
// invited address has an account: the page is reachable without a session.
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
    'Diese Einladung ist für eine andere E-Mail-Adresse bestimmt. Melde dich ab und mit der E-Mail-Adresse an, an die die Einladung ging. Hast du mit dieser Adresse noch kein Konto, registriere dich auf der Anmeldeseite.',
  redeem_failed:
    'Du bist angemeldet, aber deine Einladung konnte gerade nicht eingelöst werden. Öffne den Einladungslink in einem Moment erneut.',
};

export default async function InviteErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const error = (await searchParams).error ?? '';
  const isEmailMismatch = error === 'email_mismatch';

  // The redemption handler left the invite code in a short-lived cookie. Once
  // it has expired, the person opens the invite link again after signing in.
  const storedCode = isEmailMismatch ? (await cookies()).get(INVITE_MISMATCH_COOKIE)?.value : undefined;
  const inviteCode = storedCode !== undefined && isUuid(storedCode) ? storedCode : null;

  const title =
    (Object.hasOwn(INVITE_ERROR_TITLES, error) ? INVITE_ERROR_TITLES[error] : undefined) ??
    'Fehler bei der Einladung';
  const description = describeFailure(
    error,
    INVITE_ERROR_DESCRIPTIONS,
    'Ein unbekannter Fehler ist aufgetreten.',
  );

  return (
    <StandaloneScreen>
      <div className="mx-auto max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertCircle className="size-12 text-destructive" />
          </div>
        </div>
        <StandaloneTitle>{title}</StandaloneTitle>
        <p className="mt-2 mb-8 text-muted-foreground">
          {description}
          {isEmailMismatch && inviteCode === null
            ? ' Öffne danach den Einladungslink aus deiner E-Mail erneut.'
            : null}
        </p>

        {isEmailMismatch ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <SignOutAndRedirectButton inviteCode={inviteCode} />
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
