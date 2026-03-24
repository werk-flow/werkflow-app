import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { toClient } from '@/lib/jobs/types';
import { CreateClientDialog } from '@/components/kunden/create-client-dialog';
import { KundenContent } from '@/components/kunden/kunden-content';
import { KundenContentSkeleton } from '@/components/loading-states/kunden-content-skeleton';
import { ActionBanner } from '@/components/shared/action-banner';
import type { OrgRole } from '@/lib/members/actions';

async function KundenData({ activeOrgId }: { activeOrgId: string }) {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from('clients')
    .select('*')
    .eq('organization_id', activeOrgId)
    .order('name', { ascending: true });

  if (error) {
    console.error('Error fetching clients:', error);
    return (
      <p className="text-destructive">
        Fehler beim Laden der Kunden:{' '}
        {error.message || 'Unbekannter Fehler'}
      </p>
    );
  }

  const clientList = (data ?? []).map(toClient);

  return <KundenContent clients={clientList} />;
}

export default async function KundenPage() {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies()
  ]);

  if (!user) {
    redirect('/login');
  }

  const [activeOrgId, memberships] = await Promise.all([
    resolveActiveOrgId(cookieStore, user.id),
    getCachedMemberships(user.id)
  ]);

  if (!activeOrgId) {
    return (
      <div className="flex h-full flex-col p-6">
        <h1 className="text-2xl font-bold">Kunden</h1>
        <p className="mt-4 text-muted-foreground">
          Bitte wähle zuerst eine Organisation aus.
        </p>
      </div>
    );
  }

  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);

  const currentUserRole = currentMembership?.role as OrgRole | undefined;
  const isAdminOrManager =
    currentUserRole === 'admin' || currentUserRole === 'buero';

  if (!isAdminOrManager) {
    redirect('/dashboard');
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Suspense fallback={null}>
        <ActionBanner
          paramKey="deleted_client"
          messageTemplate='Kunde „{name}" wurde erfolgreich gelöscht.'
        />
      </Suspense>
      <header className="flex items-center justify-between border-b bg-background px-4 py-3 sm:px-6 sm:py-4 sticky top-0 z-10 shrink-0">
        <h1 className="text-xl font-bold sm:text-2xl">Kunden</h1>
        <CreateClientDialog />
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <Suspense fallback={<KundenContentSkeleton />}>
          <KundenData activeOrgId={activeOrgId} />
        </Suspense>
      </div>
    </div>
  );
}
