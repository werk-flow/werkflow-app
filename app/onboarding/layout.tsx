import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { StandaloneScreen } from '@/components/shared/standalone-screen';
import { BannerProvider } from '@/components/ui/banner';
import { Skeleton } from '@/components/ui/skeleton';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { userHasOrganizations } from '@/lib/subscription/helpers';

// The prestart page's own-task section confirms and reports through the
// banner, so onboarding provides it as the app layout does: without it the
// page failed to render for every member whose access starts later (found by
// the standalone screen audit, 2026-10-17).
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <BannerProvider>
      <StandaloneScreen>
        <Suspense fallback={<Skeleton className="h-64 w-full max-w-md rounded-lg" />}>
          <OnboardingGuard>{children}</OnboardingGuard>
        </Suspense>
      </StandaloneScreen>
    </BannerProvider>
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
