import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Building2, Users } from 'lucide-react';

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DeleteAccountButton } from '@/components/onboarding/delete-account-button';
import { OnboardingOrgDeletedBanner } from '@/components/onboarding/org-deleted-banner';

export const metadata: Metadata = {
  title: 'Onboarding - WerkFlow'
};

export default function OnboardingStartPage() {
  return (
    <div className="w-full max-w-2xl space-y-8">
      <Suspense fallback={null}>
        <OnboardingOrgDeletedBanner />
      </Suspense>
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Willkommen bei WerkFlow
        </h1>
        <p className="text-muted-foreground">Wie möchtest du starten?</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Create Organization Option */}
        <Card className="relative overflow-hidden transition-all hover:border-primary hover:shadow-md h-full">
          <Link href="/upgrade" className="absolute inset-0 z-10" />
          <CardHeader className="flex flex-col h-full space-y-4">
            <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10">
              <Building2 className="size-6 text-primary" />
            </div>
            <div className="flex-1 space-y-2">
              <CardTitle className="text-xl">Organisation erstellen</CardTitle>
              <CardDescription>
                Werde Admin und erstelle deine eigene Organisation. Lade
                Mitarbeiter ein und verwalte dein Team.
              </CardDescription>
            </div>
            <Button className="w-full mt-auto" asChild>
              <span>Admin werden</span>
            </Button>
          </CardHeader>
        </Card>

        {/* Join Organization Option */}
        <Card className="relative overflow-hidden transition-all hover:border-primary hover:shadow-md h-full">
          <Link
            href="/onboarding/join-organization"
            className="absolute inset-0 z-10"
          />
          <CardHeader className="flex flex-col h-full space-y-4">
            <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10">
              <Users className="size-6 text-primary" />
            </div>
            <div className="flex-1 space-y-2">
              <CardTitle className="text-xl">Organisation beitreten</CardTitle>
              <CardDescription>
                Du hast einen Organisationscode? Tritt einer bestehenden
                Organisation bei.
              </CardDescription>
            </div>
            <Button variant="outline" className="w-full mt-auto" asChild>
              <span>Beitreten</span>
            </Button>
          </CardHeader>
        </Card>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Du kannst später weitere Organisationen erstellen oder beitreten.
      </p>

      {/* Delete account option for orphan users */}
      <div className="flex justify-center pt-4">
        <DeleteAccountButton />
      </div>
    </div>
  );
}
