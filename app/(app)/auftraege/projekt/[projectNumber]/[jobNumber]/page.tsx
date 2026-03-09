import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getJobByNumber } from '@/lib/jobs/actions';
import { getProjectByNumber } from '@/lib/projects/actions';
import { toClient, type Client } from '@/lib/jobs/types';
import type { OrgRole } from '@/lib/members/actions';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
import { JobDetailContent } from '@/components/auftraege/job-detail-content';

interface NestedJobDetailPageProps {
  params: Promise<{ projectNumber: string; jobNumber: string }>;
}

export default async function NestedJobDetailPage({
  params,
}: NestedJobDetailPageProps) {
  const { projectNumber, jobNumber } = await params;
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
    currentUserRole === 'admin' || currentUserRole === 'manager';

  const [projectResult, jobResult] = await Promise.all([
    getProjectByNumber(decodeURIComponent(projectNumber)),
    getJobByNumber(decodeURIComponent(jobNumber)),
  ]);

  if (!projectResult.success || !jobResult.success) notFound();

  const { project } = projectResult.details;
  const { job } = jobResult;

  if (job.project?.id !== project.id) notFound();

  const admin = createSupabaseAdminClient();
  const supabase = await createSupabaseServerClient();

  let clients: Client[] = [];
  let members: OrgMemberOption[] = [];

  if (isAdminOrManager) {
    const [clientsResult, membersResult] = await Promise.all([
      admin
        .from('clients')
        .select('*')
        .eq('organization_id', activeOrgId)
        .order('name', { ascending: true }),
      supabase.rpc('get_org_members', { p_org_id: activeOrgId }),
    ]);

    clients = (clientsResult.data ?? []).map(toClient);
    members = (membersResult.data ?? []).map(
      (m: { user_id: string; first_name: string; last_name: string }) => ({
        userId: m.user_id,
        firstName: m.first_name,
        lastName: m.last_name,
      })
    );
  }

  return (
    <JobDetailContent
      job={job}
      parentProject={{
        id: project.id,
        name: project.name,
        projectNumber: project.projectNumber!,
      }}
      clients={clients}
      members={members}
      isAdminOrManager={isAdminOrManager}
    />
  );
}
