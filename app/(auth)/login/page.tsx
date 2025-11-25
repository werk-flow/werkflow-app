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
import { getSupabaseServerSession } from '@/lib/supabase/server';

import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Anmelden'
};

const SUCCESS_MESSAGES: Record<string, string> = {
  'password-reset-success':
    'Passwort erfolgreich aktualisiert. Bitte erneut einloggen.',
  'password-reset-requested':
    'Wenn eine E-Mail existiert, haben wir dir einen Link geschickt.'
};

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { session } = await getSupabaseServerSession();

  if (session) {
    redirect('/dashboard');
  }

  const params = await searchParams;
  const successMessage = params.message
    ? SUCCESS_MESSAGES[params.message]
    : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          Willkommen zurück
        </CardTitle>
        <CardDescription>
          Melde dich mit deiner E-Mail-Adresse und deinem Passwort an, um auf
          deinen Arbeitsbereich zuzugreifen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <LoginForm successMessage={successMessage} />
      </CardContent>
      <CardFooter className="flex justify-center">
        <p className="text-sm text-muted-foreground">
          Noch kein Konto?{' '}
          <Link
            href="/signup"
            className="text-primary underline-offset-4 hover:underline"
          >
            Registrieren
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
