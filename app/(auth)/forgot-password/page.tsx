import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { StandaloneTitle } from '@/components/shared/standalone-screen';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { readAddressCookie, RESET_ADDRESS_COOKIE } from '@/lib/auth/address-cookies';

import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = {
  title: 'Passwort vergessen',
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
  searchParams: Promise<{ error?: string; source?: string }>;
}) {
  const params = await searchParams;
  // The password change in the settings left the signed-in address in a
  // cookie scoped to this page; a visitor without it types the address.
  const initialEmail = readAddressCookie((await cookies()).get(RESET_ADDRESS_COOKIE)?.value) ?? '';
  const errorMessage = getErrorMessage(params.error);
  const isKnownAccountReset = params.source === 'settings';

  return (
    <Card>
      <CardHeader>
        <StandaloneTitle>Passwort zurücksetzen</StandaloneTitle>
        <CardDescription>
          Gib deine E-Mail-Adresse ein und wir senden dir einen Link zum Zurücksetzen deines Passworts.
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
