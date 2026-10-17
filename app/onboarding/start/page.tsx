import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Building2, Users } from 'lucide-react';

import { StandaloneTitle } from '@/components/shared/standalone-screen';
import { Card, CardDescription, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DeleteAccountButton } from '@/components/onboarding/delete-account-button';
import { UrlFlashBanner } from '@/components/ui/banner';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { readOwnLatestJoinRequest } from '@/lib/org/join-requests';

export const metadata: Metadata = {
  title: 'Onboarding - WerkFlow',
};

export default async function OnboardingStartPage() {
  // A person whose join request waits goes straight to the waiting state.
  const user = await getAuthenticatedUser();
  if (!user) redirect('/login');
  const latest = await readOwnLatestJoinRequest(user.id);
  if (!latest.success) throw new Error('join_request_read_failed');
  if (latest.request?.status === 'pending') redirect('/onboarding/join-organization');

  return (
    <div className="w-full max-w-2xl space-y-8">
      <Suspense fallback={null}>
        <UrlFlashBanner
          paramKey="org_deleted"
          messageTemplate="Die Organisation wurde erfolgreich gelöscht."
        />
      </Suspense>
      <div className="text-center space-y-2">
        <StandaloneTitle>Willkommen bei WerkFlow</StandaloneTitle>
        <p className="text-muted-foreground">Wie möchtest du starten?</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Create Organization Option */}
        <Card className="relative h-full overflow-hidden transition-colors hover:bg-muted/50">
          <Link href="/upgrade" aria-label="Organisation erstellen" className="absolute inset-0 z-10" />
          <CardHeader className="flex flex-col h-full space-y-4">
            <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
              <Building2 className="size-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="flex-1 space-y-2">
              <h2 className="text-lg font-semibold">Organisation erstellen</h2>
              <CardDescription>
                Werde Admin und erstelle deine eigene Organisation. Lade Mitarbeiter ein und verwalte dein
                Team.
              </CardDescription>
            </div>
            <Button className="w-full mt-auto" asChild>
              <span>Admin werden</span>
            </Button>
          </CardHeader>
        </Card>

        {/* Join Organization Option */}
        <Card className="relative h-full overflow-hidden transition-colors hover:bg-muted/50">
          <Link
            href="/onboarding/join-organization"
            aria-label="Organisation beitreten"
            className="absolute inset-0 z-10"
          />
          <CardHeader className="flex flex-col h-full space-y-4">
            <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
              <Users className="size-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="flex-1 space-y-2">
              <h2 className="text-lg font-semibold">Organisation beitreten</h2>
              <CardDescription>
                Du hast einen Organisationscode? Tritt einer bestehenden Organisation bei.
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
