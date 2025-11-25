import type { Metadata } from 'next';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';

import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = {
  title: 'Passwort zurücksetzen'
};

export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          Neues Passwort festlegen
        </CardTitle>
        <CardDescription>
          Gib dein neues Passwort ein, um den Zurücksetzungsvorgang
          abzuschließen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm />
      </CardContent>
    </Card>
  );
}
