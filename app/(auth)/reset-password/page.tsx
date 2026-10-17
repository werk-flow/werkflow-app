import type { Metadata } from 'next';
import { StandaloneTitle } from '@/components/shared/standalone-screen';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = {
  title: 'Passwort zurücksetzen',
};

export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <StandaloneTitle>Neues Passwort festlegen</StandaloneTitle>
        <CardDescription>
          Gib dein neues Passwort ein, um den Zurücksetzungsvorgang abzuschließen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm />
      </CardContent>
    </Card>
  );
}
