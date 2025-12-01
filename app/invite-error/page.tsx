import Link from 'next/link';
import { AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SignOutAndRedirectButton } from './sign-out-redirect-button';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const ERROR_MESSAGES: Record<string, { title: string; description: string }> = {
  admin_mismatch: {
    title: 'Einladung nicht möglich',
    description:
      'Du kannst dieser Organisation nicht beitreten, da sie einem anderen Administrator gehört als deine bestehenden Organisationen.'
  },
  invalid_invite: {
    title: 'Ungültige Einladung',
    description: 'Der Einladungslink ist ungültig oder existiert nicht mehr.'
  },
  invite_expired: {
    title: 'Einladung abgelaufen',
    description:
      'Diese Einladung ist abgelaufen. Bitte fordere eine neue Einladung an.'
  },
  invite_cancelled: {
    title: 'Einladung zurückgezogen',
    description:
      'Diese Einladung wurde vom Administrator zurückgezogen. Bitte fordere eine neue Einladung an.'
  },
  invite_already_used: {
    title: 'Einladung bereits verwendet',
    description:
      'Diese Einladung wurde bereits von einem anderen Benutzer verwendet. Bitte fordere eine neue Einladung an.'
  },
  email_mismatch: {
    title: 'Falsche E-Mail-Adresse',
    description:
      'Diese Einladung ist für eine andere E-Mail-Adresse bestimmt. Bitte melde dich ab und melde dich mit der richtigen E-Mail-Adresse an.'
  }
};

// Helper to mask email for privacy (e.g., "test@example.com" -> "t***@example.com")
function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!domain) return email;
  const maskedLocal =
    localPart.length > 1 ? localPart[0] + '***' : localPart + '***';
  return `${maskedLocal}@${domain}`;
}

export default async function InviteErrorPage({
  searchParams
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

  // Check if the invited user already exists (for email mismatch case)
  // Use RPC function that bypasses RLS to check auth.users
  let isExistingUser = false;
  if (isEmailMismatch && invitedEmail) {
    const supabase = await createSupabaseServerClient();
    const { data: userCheckResult } = await supabase.rpc(
      'check_user_exists_by_email',
      { p_email: invitedEmail.toLowerCase() }
    );

    // The RPC returns an array, get the first result
    const userCheck = Array.isArray(userCheckResult)
      ? userCheckResult[0]
      : userCheckResult;
    isExistingUser = userCheck?.user_exists === true;
  }

  let errorInfo = ERROR_MESSAGES[error] || {
    title: 'Fehler bei der Einladung',
    description: 'Ein unbekannter Fehler ist aufgetreten.'
  };

  // Customize the description for email mismatch to include the invited email
  if (isEmailMismatch && invitedEmail) {
    const actionText = isExistingUser
      ? 'melde dich mit der richtigen E-Mail-Adresse an'
      : 'erstelle ein Konto mit der richtigen E-Mail-Adresse';
    errorInfo = {
      ...errorInfo,
      description: `Diese Einladung ist für ${maskEmail(
        invitedEmail
      )} bestimmt. Du bist aktuell mit einer anderen E-Mail-Adresse angemeldet. Bitte melde dich ab und ${actionText}.`
    };
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mx-auto max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertCircle className="size-12 text-destructive" />
          </div>
        </div>
        <h1 className="mb-2 text-2xl font-bold">{errorInfo.title}</h1>
        <p className="mb-8 text-muted-foreground">{errorInfo.description}</p>

        {isEmailMismatch ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <SignOutAndRedirectButton
              inviteCode={inviteCode}
              invitedEmail={invitedEmail}
              isExistingUser={isExistingUser}
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
    </main>
  );
}
