import { SectionError } from '@/components/ui/section-error';
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { parseListPage } from '@/lib/ui/list-pagination';
import { type ListSearchParams } from '@/lib/jobs/list-page';
import { readCustomerPage } from '@/lib/clients/list-page-server';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { CreateClientDialog } from '@/components/kunden/create-client-dialog';
import { KundenContent } from '@/components/kunden/kunden-content';
import { KundenContentSkeleton } from '@/components/loading-states/kunden-content-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { UrlFlashBanner } from '@/components/ui/banner';
import type { OrgRole } from '@/lib/members/actions';

async function KundenData({ activeOrgId, scopeKey, searchParams }: { activeOrgId: string; scopeKey: string; searchParams: Promise<ListSearchParams> }) {
  const params = await searchParams;
  const search = typeof params.q === 'string' ? params.q.trim().slice(0, 250) : '';
  const page = parseListPage(typeof params.page === 'string' ? params.page : undefined);
  const data = await readCustomerPage({ organizationId: activeOrgId, page, search }).catch(() => null);
  if (!data) return <SectionError>Kunden konnten nicht geladen werden. Bitte aktualisiere die Seite.</SectionError>;
  // The component keys its list by scope, page and search itself so the
  // search input and pending navigation survive each committed change.
  return <KundenContent scopeKey={scopeKey} organizationId={activeOrgId} clients={data.clients} page={page} total={data.total} searchQuery={search} />;
}
export default async function KundenPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<ListSearchParams> }) {
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
          <KundenData activeOrgId={activeOrgId} scopeKey={`${activeOrgId}:${user.id}:${currentUserRole}`} searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </PageShell>
  );
}
