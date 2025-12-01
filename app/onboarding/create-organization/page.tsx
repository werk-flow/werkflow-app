import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  isUserSubscribed,
  userHasOrganizations
} from '@/lib/subscription/helpers';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';

import { CreateOrganizationForm } from './create-organization-form';

export const metadata: Metadata = {
  title: 'Organisation erstellen - WerkFlow'
};

export default async function CreateOrganizationPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // If user already has organizations, redirect to dashboard
  const hasOrgs = await userHasOrganizations(user.id);
  if (hasOrgs) {
    redirect('/dashboard');
  }

  // If user is not subscribed, redirect to upgrade page
  const subscribed = await isUserSubscribed(user.id);
  if (!subscribed) {
    redirect('/upgrade');
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">
          Lass uns deine Organisation erstellen
        </CardTitle>
        <CardDescription>
          Gib deiner Organisation einen Namen. Du kannst ihn später jederzeit
          ändern.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CreateOrganizationForm />
      </CardContent>
    </Card>
  );
}



