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
import {
  CreateRequestDialog,
  type RequestAssigneeOption,
} from '@/components/anfragen/create-request-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { OrgRole } from '@/lib/members/actions';

function formatProfileName(profile: {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}): string {
  return (
    [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
    profile.email ||
    'Unbekannt'
  );
}

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
        Fehler beim Laden der Anfragen:{' '}
        {requestsResult.error.message || 'Unbekannter Fehler'}
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
      ? admin.from('jobs').select('id, title, job_number').in('id', convertedJobIds)
      : Promise.resolve({ data: [] }),
    convertedProjectIds.length > 0
      ? admin
          .from('projects')
          .select('id, name, project_number')
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

  const [clientsResult, membersResult] = await Promise.all([
    admin
      .from('clients')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('name', { ascending: true }),
    admin
      .from('organization_members')
      .select('user_id, role, profiles(id, first_name, last_name, email)')
      .eq('organization_id', activeOrgId),
  ]);

  const clients = (clientsResult.data ?? []).map(toClient);
  // Requests are handled by the office; only admin/Büro appear as responsible.
  const assignees: RequestAssigneeOption[] = (membersResult.data ?? [])
    .filter((member) => member.role === 'admin' || member.role === 'buero')
    .map((member) => {
      const profile = member.profiles as unknown as {
        first_name: string | null;
        last_name: string | null;
        email: string | null;
      } | null;
      return {
        userId: member.user_id,
        name: profile ? formatProfileName(profile) : 'Unbekannt',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

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
      <div className="flex h-full flex-col p-6">
        <h1 className="text-2xl font-bold">Anfragen</h1>
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
      <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-background px-4 py-3 sm:px-6 sm:py-4">
        <h1 className="text-xl font-bold sm:text-2xl">Anfragen</h1>
        <Suspense fallback={<Skeleton className="h-9 w-36 rounded-md" />}>
          <CreateRequestDialogData activeOrgId={activeOrgId} />
        </Suspense>
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <Suspense
          fallback={
            <div className="space-y-2">
              <Skeleton className="h-9 w-72" />
              <Skeleton className="h-40 w-full" />
            </div>
          }
        >
          <AnfragenData activeOrgId={activeOrgId} />
        </Suspense>
      </div>
    </div>
  );
}
