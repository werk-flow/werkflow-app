import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { OTPForm } from '@/components/otp-form';
import { getSupabaseServerSession } from '@/lib/supabase/server';

type SearchParamsInput =
  | Promise<Record<string, string | string[] | undefined>>
  | Record<string, string | string[] | undefined>;

type VerifyPageProps = {
  searchParams: SearchParamsInput;
};

export const metadata: Metadata = {
  title: 'E-Mail bestätigen'
};

function resolveQueryParam(
  params: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = params[key];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default async function VerifyPage({ searchParams }: VerifyPageProps) {
  const { session } = await getSupabaseServerSession();

  if (session) {
    redirect('/dashboard');
  }

  const resolvedSearchParams =
    typeof (searchParams as SearchParamsInput & { then?: unknown }).then ===
    'function'
      ? await (searchParams as Promise<
          Record<string, string | string[] | undefined>
        >)
      : (searchParams as Record<string, string | string[] | undefined>);

  const email = resolveQueryParam(resolvedSearchParams, 'email');

  if (!email) {
    redirect('/signup');
  }

  return <OTPForm email={email} />;
}
