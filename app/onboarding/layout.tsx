import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { userHasOrganizations } from '@/lib/subscription/helpers';

export default async function OnboardingLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  // Redirect to login if not authenticated
  if (!user) {
    redirect('/login');
  }

  // If user already has organizations, redirect to dashboard
  const hasOrgs = await userHasOrganizations(user.id);
  if (hasOrgs) {
    redirect('/dashboard');
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      {/* Logo */}
      <Link href="/" className="mb-8">
        {/* Light mode logo */}
        <Image
          src="/logo-text-light.svg"
          alt="WerkFlow"
          width={180}
          height={40}
          className="h-10 w-auto dark:hidden"
          priority
        />
        {/* Dark mode logo */}
        <Image
          src="/logo-text-dark.svg"
          alt="WerkFlow"
          width={180}
          height={40}
          className="hidden h-10 w-auto dark:block"
          priority
        />
      </Link>
      {children}
    </div>
  );
}
