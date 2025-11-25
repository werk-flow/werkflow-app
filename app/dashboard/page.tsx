import { redirect } from 'next/navigation';

import { getSupabaseServerSession } from '@/lib/supabase/server';

import { SignOutButton } from './sign-out-button';

export default async function DashboardPage() {
  const { session } = await getSupabaseServerSession();

  if (!session) {
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-end border-b px-6 py-4">
        <SignOutButton />
      </header>
      <main className="flex flex-1 items-center justify-center px-6">
        <p className="text-lg font-medium">
          Diese Seite ist nur für angemeldete Nutzer sichtbar.
        </p>
      </main>
    </div>
  );
}
