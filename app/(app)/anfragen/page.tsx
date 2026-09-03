import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { toClient } from '@/lib/jobs/types';
import { toClientRequest } from '@/lib/requests/types';
import {
  AnfragenContent,
  type RequestListEntry,
} from '@/components/anfragen/anfragen-content';
import { CreateRequestDialog } from '@/components/anfragen/create-request-dialog';
import { AnfragenContentSkeleton } from '@/components/loading-states/anfragen-page-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import type { OrgRole } from '@/lib/members/actions';
import {
  formatProfileName,
  getManagerAssigneeOptions,
} from '@/lib/members/profile-name';

async function AnfragenData({ activeOrgId }: { activeOrgId: string }) {
  const admin = createSupabaseAdminClient();

  const [requestsResult, clientsResult] = await Promise.all([
    admin
      .from('client_requests')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('received_at', { ascending: false }),
    admin
      .from('clients')
      .select('id, name')
      .eq('organization_id', activeOrgId),
  ]);

  if (requestsResult.error) {
    console.error('Error fetching client requests:', requestsResult.error);
    return (
      <p className="text-destructive">
        Die Anfragen konnten nicht geladen werden. Bitte versuche es erneut.
      </p>
    );
  }

  const requests = (requestsResult.data ?? []).map(toClientRequest);
  const clientNameById = new Map(
    (clientsResult.data ?? []).map((client) => [client.id, client.name])
  );

  const assigneeIds = Array.from(
    new Set(
      requests
        .map((request) => request.assignedTo)
        .filter((id): id is string => Boolean(id))
    )
  );
  const convertedJobIds = requests
    .map((request) => request.convertedJobId)
    .filter((id): id is string => Boolean(id));
  const convertedProjectIds = requests
    .map((request) => request.convertedProjectId)
    .filter((id): id is string => Boolean(id));

  const [profilesResult, jobsResult, projectsResult] = await Promise.all([
    assigneeIds.length > 0
      ? admin
          .from('profiles')
          .select('id, first_name, last_name, email')
          .in('id', assigneeIds)
      : Promise.resolve({ data: [] }),
    convertedJobIds.length > 0
      ? admin
          .from('jobs')
          .select('id, title, job_number')
          .eq('organization_id', activeOrgId)
          .in('id', convertedJobIds)
      : Promise.resolve({ data: [] }),
    convertedProjectIds.length > 0
      ? admin
          .from('projects')
          .select('id, name, project_number')
          .eq('organization_id', activeOrgId)
          .in('id', convertedProjectIds)
      : Promise.resolve({ data: [] }),
  ]);

  const profileById = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.id, profile])
  );
  const jobById = new Map((jobsResult.data ?? []).map((job) => [job.id, job]));
  const projectById = new Map(
    (projectsResult.data ?? []).map((project) => [project.id, project])
  );

  const entries: RequestListEntry[] = requests.map((request) => {
    const assignee = request.assignedTo
      ? profileById.get(request.assignedTo)
      : null;
    const job = request.convertedJobId
      ? jobById.get(request.convertedJobId)
      : null;
    const project = request.convertedProjectId
      ? projectById.get(request.convertedProjectId)
      : null;

    return {
      request,
      clientName: request.clientId
        ? (clientNameById.get(request.clientId) ?? null)
        : null,
      assigneeName: assignee ? formatProfileName(assignee) : null,
      convertedLabel: job
        ? `Auftrag ${job.job_number ?? job.title}`
        : project
          ? `Projekt ${project.project_number ?? project.name}`
          : null,
    };
  });

  return <AnfragenContent entries={entries} />;
}

async function CreateRequestDialogData({ activeOrgId }: { activeOrgId: string }) {
  const admin = createSupabaseAdminClient();

  const [clientsResult, assignees] = await Promise.all([
    admin
      .from('clients')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('name', { ascending: true }),
    getManagerAssigneeOptions(admin, activeOrgId),
  ]);

  const clients = (clientsResult.data ?? []).map(toClient);

  return <CreateRequestDialog clients={clients} assignees={assignees} />;
}

export default async function AnfragenPage() {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies(),
  ]);

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
          <AnfragenData activeOrgId={activeOrgId} />
        </Suspense>
      </PageBody>
    </PageShell>
  );
}
