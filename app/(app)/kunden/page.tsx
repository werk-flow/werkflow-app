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
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { UrlFlashBanner } from '@/components/ui/banner';
import type { OrgRole } from '@/lib/members/actions';

async function KundenData({ activeOrgId }: { activeOrgId: string }) {
  const admin = createSupabaseAdminClient();

  const [clientsResult, contactsResult, sitesResult] = await Promise.all([
    admin
      .from('clients')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('name', { ascending: true }),
    admin
      .from('client_contacts')
      .select('client_id, name')
      .eq('organization_id', activeOrgId)
      .eq('is_active', true),
    admin
      .from('client_sites')
      .select('client_id, name, street, postal_code, city')
      .eq('organization_id', activeOrgId)
      .eq('is_active', true),
  ]);

  if (clientsResult.error) {
    console.error('Error fetching clients:', clientsResult.error);
    return (
      <p className="text-destructive">
        Fehler beim Laden der Kunden:{' '}
        {clientsResult.error.message || 'Unbekannter Fehler'}
      </p>
    );
  }

  const clientList = (clientsResult.data ?? []).map(toClient);

  if (contactsResult.error) {
    console.error('Error fetching client contacts for search:', contactsResult.error);
  }
  if (sitesResult.error) {
    console.error('Error fetching client sites for search:', sitesResult.error);
  }

  // Per-customer search haystack so the list search also finds customers via
  // contact names and site addresses (CRM spec §3).
  const searchIndex: Record<string, string> = {};
  for (const contact of contactsResult.data ?? []) {
    searchIndex[contact.client_id] =
      `${searchIndex[contact.client_id] ?? ''} ${contact.name}`;
  }
  for (const site of sitesResult.data ?? []) {
    searchIndex[site.client_id] =
      `${searchIndex[site.client_id] ?? ''} ${site.name} ${site.street ?? ''} ${site.postal_code ?? ''} ${site.city ?? ''}`;
  }

  return <KundenContent clients={clientList} searchIndex={searchIndex} />;
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
      <PageShell>
        <PageHeader title="Kunden" />
        <PageBody>
          <p className="text-muted-foreground">
            Bitte wähle zuerst eine Organisation aus.
          </p>
        </PageBody>
      </PageShell>
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
    <PageShell>
      <Suspense fallback={null}>
        <UrlFlashBanner
          paramKey="deleted_client"
          messageTemplate='Kunde „{name}" wurde erfolgreich gelöscht.'
        />
      </Suspense>
      <PageHeader title="Kunden" actions={<CreateClientDialog />} />

      <PageBody>
        <Suspense fallback={<KundenContentSkeleton />}>
          <KundenData activeOrgId={activeOrgId} />
        </Suspense>
      </PageBody>
    </PageShell>
  );
}
