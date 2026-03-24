import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getProjectByNumber } from '@/lib/projects/actions';
import { toClient, type Client } from '@/lib/jobs/types';
import { ActionBanner } from '@/components/shared/action-banner';
import type { OrgRole } from '@/lib/members/actions';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
import { ProjectDetailContent } from '@/components/auftraege/project-detail-content';
import ProjectDetailLoading from './loading';

interface ProjectDetailPageProps {
  params: Promise<{ projectNumber: string }>;
}

async function ProjectDetailData({
  projectNumber,
}: {
  projectNumber: string;
}) {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies(),
  ]);

  if (!user) redirect('/login');

  const activeOrgId = await resolveActiveOrgId(cookieStore, user.id);
  if (!activeOrgId) redirect('/auftraege');

  const memberships = await getCachedMemberships(user.id);
  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);
  const currentUserRole = currentMembership?.role as OrgRole | undefined;
  const isAdminOrManager =
    currentUserRole === 'admin' || currentUserRole === 'buero';

  const admin = createSupabaseAdminClient();
  const supabase = await createSupabaseServerClient();

  const [result, clientsResult, membersResult] = await Promise.all([
    getProjectByNumber(decodeURIComponent(projectNumber)),
    isAdminOrManager
      ? admin
          .from('clients')
          .select('*')
          .eq('organization_id', activeOrgId)
          .order('name', { ascending: true })
      : Promise.resolve({ data: null }),
    isAdminOrManager
      ? supabase.rpc('get_org_members', { p_org_id: activeOrgId })
      : Promise.resolve({ data: null }),
  ]);

  if (!result.success) notFound();

  const { project, client, jobs, derivedStatus } = result.details;

  const clients: Client[] = (clientsResult.data ?? []).map(toClient);
  const members: OrgMemberOption[] = (membersResult.data ?? []).map(
    (m: { user_id: string; first_name: string; last_name: string; role: string }) => ({
      userId: m.user_id,
      firstName: m.first_name,
      lastName: m.last_name,
      role: m.role,
    })
  );

  return (
    <>
      <Suspense fallback={null}>
        <ActionBanner
          paramKey="deleted_job"
          messageTemplate='Auftrag „{name}" wurde erfolgreich gelöscht.'
        />
      </Suspense>
      <ProjectDetailContent
        project={project}
        client={client}
        jobs={jobs}
        derivedStatus={derivedStatus}
        clients={clients}
        members={members}
        isAdminOrManager={isAdminOrManager}
      />
    </>
  );
}

export default async function ProjectDetailPage({
  params,
}: ProjectDetailPageProps) {
  const { projectNumber } = await params;

  return (
    <Suspense fallback={<ProjectDetailLoading />}>
      <ProjectDetailData projectNumber={projectNumber} />
    </Suspense>
  );
}
