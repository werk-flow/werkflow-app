import { RegionLoadError } from '@/components/shared/region-load-error';
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { parseRequestListQuery } from '@/lib/requests/list-page';
import { readRequestPage } from '@/lib/requests/list-page-server';
import { AnfragenContent } from '@/components/anfragen/anfragen-content';
import { CreateRequestDialog } from '@/components/anfragen/create-request-dialog';
import { AnfragenContentSkeleton } from '@/components/loading-states/anfragen-page-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import type { OrgRole } from '@/lib/members/actions';
import { getManagerAssigneeOptions } from '@/lib/members/profile-name';

async function AnfragenData({
  activeOrgId,
  searchParams,
}: {
  activeOrgId: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseRequestListQuery(await searchParams);
  const page = await readRequestPage(activeOrgId, query).catch((error: unknown) => {
    logError('anfragen.page.read_failed', error);
    return null;
  });
  if (!page) {
    return (
      <RegionLoadError>Die Anfragen konnten nicht geladen werden. Bitte versuche es erneut.</RegionLoadError>
    );
  }
  return <AnfragenContent {...page} query={query} />;
}

async function CreateRequestDialogData({ activeOrgId }: { activeOrgId: string }) {
  const admin = createSupabaseAdminClient();

  const assignees = await getManagerAssigneeOptions(admin, activeOrgId);

  if (!assignees.success) {
    return <RegionLoadError>Die Zuständigen für neue Anfragen konnten nicht geladen werden.</RegionLoadError>;
  }
  return <CreateRequestDialog assignees={assignees.options} />;
}

export default async function AnfragenPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [
    {
      data: { user },
    },
    cookieStore,
  ] = await Promise.all([getCachedUser(), cookies()]);

  if (!user) {
    redirect('/login');
  }

  const [activeOrgId, memberships] = await Promise.all([
    resolveActiveOrgId(cookieStore, user.id),
    getCachedMemberships(user.id),
  ]);

  if (!activeOrgId) {
    return (
      <PageShell>
        <PageHeader title="Anfragen" />
        <PageBody>
          <p className="text-muted-foreground">Bitte wähle zuerst eine Organisation aus.</p>
        </PageBody>
      </PageShell>
    );
  }

  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);
  const currentUserRole = currentMembership?.role as OrgRole | undefined;
  const isAdminOrManager = currentUserRole === 'admin' || currentUserRole === 'buero';

  if (!isAdminOrManager) {
    redirect('/dashboard');
  }

  return (
    <PageShell>
      <PageHeader
        title="Anfragen"
        actions={
          <Suspense fallback={<Skeleton className="h-9 w-32" />}>
            <CreateRequestDialogData activeOrgId={activeOrgId} />
          </Suspense>
        }
      />

      <PageBody>
        <Suspense fallback={<AnfragenContentSkeleton />}>
          <AnfragenData activeOrgId={activeOrgId} searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </PageShell>
  );
}
