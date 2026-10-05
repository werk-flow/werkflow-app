import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { StandaloneScreen } from '@/components/shared/standalone-screen';
import { Skeleton } from '@/components/ui/skeleton';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { userHasOrganizations } from '@/lib/subscription/helpers';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <StandaloneScreen>
      <Suspense fallback={<Skeleton className="h-64 w-full max-w-md rounded-lg" />}>
        <OnboardingGuard>{children}</OnboardingGuard>
      </Suspense>
    </StandaloneScreen>
  );
}

async function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect('/login');
  }

  const hasOrgs = await userHasOrganizations(user.id);
  if (hasOrgs) {
    redirect('/dashboard');
  }

  return <>{children}</>;
}
