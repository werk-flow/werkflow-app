import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { readOpenReservation, userHasOrganizations } from '@/lib/subscription/helpers';
import { StandaloneTitle } from '@/components/shared/standalone-screen';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

import { CreateOrganizationForm } from './create-organization-form';

export const metadata: Metadata = {
  title: 'Organisation erstellen - WerkFlow',
};

export default async function CreateOrganizationPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // If user already has organizations, redirect to dashboard
  const hasOrgs = await userHasOrganizations(user.id);
  if (hasOrgs) {
    redirect('/dashboard');
  }

  // Only a paid Checkout's reservation creates an organization.
  const reservation = await readOpenReservation(user.id);
  if (!reservation?.holdsSubscription) {
    redirect('/upgrade');
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <StandaloneTitle>Lass uns deine Organisation erstellen</StandaloneTitle>
        <CardDescription>
          Gib deiner Organisation einen Namen. Du kannst ihn später jederzeit ändern.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CreateOrganizationForm />
      </CardContent>
    </Card>
  );
}
