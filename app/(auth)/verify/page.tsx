import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { OTPForm } from '@/components/otp-form';
import { getSupabaseServerSession } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/data/cached';
import { getAuthenticatedRedirectPath } from '@/lib/auth/redirects';
import { readAddressCookie, VERIFY_ADDRESS_COOKIE } from '@/lib/auth/address-cookies';
import { isUuid } from '@/lib/validation/uuid';

export const metadata: Metadata = {
  title: 'E-Mail bestätigen',
};

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ invite_code?: string }>;
}) {
  const { session } = await getSupabaseServerSession();

  if (session) {
    const {
      data: { user },
    } = await getCachedUser();
    if (user) {
      redirect(await getAuthenticatedRedirectPath(user.id));
    }
  }

  // The signup or the login left the address in a cookie scoped to this page.
  // Once it has expired, the person starts again where it is set.
  const email = readAddressCookie((await cookies()).get(VERIFY_ADDRESS_COOKIE)?.value);
  if (!email) {
    redirect('/signup');
  }

  // Invite codes are generated UUIDs; anything else is neither redeemed nor echoed.
  const rawInviteCode = (await searchParams).invite_code;
  const inviteCode = rawInviteCode && isUuid(rawInviteCode) ? rawInviteCode : undefined;

  return <OTPForm email={email} inviteCode={inviteCode} />;
}
