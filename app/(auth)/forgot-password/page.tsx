import type { Metadata } from 'next';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { reportAuthUsersStringColumnHealth } from '@/lib/supabase/auth-health';

import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = {
  title: 'Passwort vergessen'
};

function getErrorMessage(error: string | undefined) {
  if (!error) {
    return null;
  }

  if (error === 'invalid_code' || error === 'invalid_token') {
    return 'Der Link zum Zurücksetzen des Passworts ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.';
  }

  return 'Es ist ein Fehler aufgetreten. Bitte fordere einen neuen Link an.';
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; error?: string; source?: string }>;
}) {
  await reportAuthUsersStringColumnHealth('forgot-password-page');
  const params = await searchParams;
  const initialEmail = typeof params.email === 'string' ? params.email : '';
  const errorMessage = getErrorMessage(params.error);
  const isKnownAccountReset = params.source === 'settings';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          Passwort zurücksetzen
        </CardTitle>
        <CardDescription>
          Gib deine E-Mail-Adresse ein und wir senden dir einen Link zum
          Zurücksetzen deines Passworts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ForgotPasswordForm
          initialEmail={initialEmail}
          serverErrorMessage={errorMessage}
          isKnownAccountReset={isKnownAccountReset}
        />
      </CardContent>
    </Card>
  );
}
