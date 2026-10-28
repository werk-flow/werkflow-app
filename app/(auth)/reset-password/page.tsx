import type { Metadata } from 'next';
import { StandaloneTitle } from '@/components/shared/standalone-screen';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { getCachedUser } from '@/lib/data/cached';
import { getSupabaseServerSession } from '@/lib/supabase/server';

import { ConfirmRecoveryLink } from './confirm-recovery-link';
import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = {
  title: 'Passwort zurücksetzen',
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  // The link from the reset email arrives here through /auth/callback, which
  // signs in nobody: the person confirms first (lib/auth/recovery-link.ts).
  const { step } = await searchParams;
  if (step === 'confirm') {
    return (
      <Card>
        <CardHeader>
          <StandaloneTitle>Neues Passwort festlegen</StandaloneTitle>
          <CardDescription>
            Du hast den Link aus der E-Mail zum Zurücksetzen deines Passworts geöffnet. Bestätige, dass du
            jetzt ein neues Passwort festlegen willst. Hast du das nicht angefordert, schließ diese Seite
            einfach.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConfirmRecoveryLink />
        </CardContent>
      </Card>
    );
  }

  // The confirmed link signed its account in; the person sees which one.
  const { session } = await getSupabaseServerSession();
  const email = session ? (await getCachedUser()).data.user?.email : undefined;
  return (
    <Card>
      <CardHeader>
        <StandaloneTitle>Neues Passwort festlegen</StandaloneTitle>
        <CardDescription>
          {email
            ? `Gib das neue Passwort für das Konto ${email} ein.`
            : 'Gib dein neues Passwort ein, um den Zurücksetzungsvorgang abzuschließen.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm />
      </CardContent>
    </Card>
  );
}
