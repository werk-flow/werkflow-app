import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { getSupabaseServerSession } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/data/cached';
import { getAuthenticatedRedirectPath } from '@/lib/auth/redirects';

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeRedirect />
    </Suspense>
  );
}

async function HomeRedirect() {
  const { session } = await getSupabaseServerSession();

  if (!session) {
    redirect('/login');
  }

  const { data: { user } } = await getCachedUser();
  if (!user) {
    redirect('/login');
  }

  redirect(await getAuthenticatedRedirectPath(user.id));
  return null;
}
