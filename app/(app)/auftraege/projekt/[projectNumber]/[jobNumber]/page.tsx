import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getJobByNumber } from '@/lib/jobs/actions';
import { getJobInstructionItems } from '@/lib/jobs/instruction-items-actions';
import { getProjectByNumber } from '@/lib/projects/actions';
import { toClient } from '@/lib/jobs/types';
import { getOrgMembersForUser, type OrgRole } from '@/lib/members/actions';
import { JobDetailContent } from '@/components/auftraege/job-detail-content';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
import { RouteRedirect } from '@/components/shared/route-redirect';
import NestedJobDetailLoading from './loading';

interface NestedJobDetailPageProps {
  params: Promise<{ projectNumber: string; jobNumber: string }>;
}

async function NestedJobDetailData({
  projectNumber,
  jobNumber,
}: {
  projectNumber: string;
  jobNumber: string;
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

  const [
    projectResult,
    jobResult,
    membersResult,
    clientsResult,
  ] = await Promise.all([
    getProjectByNumber(decodeURIComponent(projectNumber)),
    getJobByNumber(decodeURIComponent(jobNumber)),
    getOrgMembersForUser(activeOrgId, user.id),
    admin
      .from('clients')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('name', { ascending: true }),
  ]);

  if (!projectResult.success || !jobResult.success) {
    return (
      <RouteRedirect href="/auftraege">
        <NestedJobDetailLoading />
      </RouteRedirect>
    );
  }

  const { project } = projectResult.details;
  const { job } = jobResult;
  const instructionItemsResult = await getJobInstructionItems(job.id);
  const members: OrgMemberOption[] = membersResult.map((member) => ({
    userId: member.user_id,
    firstName: member.first_name,
    lastName: member.last_name,
    role: member.role,
  }));
  const clients = (clientsResult.data ?? []).map(toClient);

  if (job.project?.id !== project.id) {
    return (
      <RouteRedirect href="/auftraege">
        <NestedJobDetailLoading />
      </RouteRedirect>
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
      projects={[]}
      isAdminOrManager={isAdminOrManager}
      instructionItems={instructionItemsResult.success ? instructionItemsResult.items : []}
      currentUserId={user.id}
    />
  );
}

export default async function NestedJobDetailPage({
  params,
}: NestedJobDetailPageProps) {
  const { projectNumber, jobNumber } = await params;

  return (
    <NestedJobDetailData
      projectNumber={projectNumber}
      jobNumber={jobNumber}
    />
  );
}
