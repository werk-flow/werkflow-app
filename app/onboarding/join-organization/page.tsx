import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';

import { JoinOrganizationForm } from './join-organization-form';

export const metadata: Metadata = {
  title: 'Organisation beitreten - WerkFlow'
};

export default async function JoinOrganizationPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Organisation beitreten</CardTitle>
        <CardDescription>
          Gib den Organisationscode ein, den du von deinem Admin erhalten hast,
          um der Organisation beizutreten.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <JoinOrganizationForm />
        <div className="text-center">
          <Link
            href="/onboarding/start"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
            Zurück
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

