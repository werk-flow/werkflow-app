import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSupabaseServerSession } from '@/lib/supabase/server';

export default async function NotFoundPage() {
  const { session } = await getSupabaseServerSession();

  if (!session) {
    redirect('/login');
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center space-y-6 bg-background px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">
        Seite nicht gefunden
      </h1>
      <p className="max-w-md text-muted-foreground">
        Die angeforderte Seite existiert nicht oder wurde verschoben. Überprüfe
        die eingegebene Adresse oder kehre zum Dashboard zurück.
      </p>
      <Link
        href="/dashboard"
        className="text-primary underline-offset-4 hover:underline"
      >
        Zurück zum Dashboard
      </Link>
    </main>
  );
}
