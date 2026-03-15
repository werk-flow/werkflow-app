import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';

import { Skeleton } from '@/components/ui/skeleton';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { userHasOrganizations } from '@/lib/subscription/helpers';

export default function OnboardingLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <Link href="/" className="mb-8">
        <Image
          src="/logo-text-light.svg"
          alt="WerkFlow"
          width={180}
          height={40}
          className="h-10 w-auto dark:hidden"
          priority
        />
        <Image
          src="/logo-text-dark.svg"
          alt="WerkFlow"
          width={180}
          height={40}
          className="hidden h-10 w-auto dark:block"
          priority
        />
      </Link>
      <Suspense
        fallback={
          <Skeleton className="h-64 w-full max-w-md rounded-lg" />
        }
      >
        <OnboardingGuard>{children}</OnboardingGuard>
      </Suspense>
    </div>
  );
}

async function OnboardingGuard({
  children
}: {
  children: React.ReactNode;
}) {
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
