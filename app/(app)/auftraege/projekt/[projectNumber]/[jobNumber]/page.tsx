import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getJobByNumber } from '@/lib/jobs/actions';
import { getProjectByNumber } from '@/lib/projects/actions';
import type { OrgRole } from '@/lib/members/actions';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
import { JobDetailContent } from '@/components/auftraege/job-detail-content';
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

  const supabase = await createSupabaseServerClient();

  const [projectResult, jobResult, membersResult] = await Promise.all([
    getProjectByNumber(decodeURIComponent(projectNumber)),
    getJobByNumber(decodeURIComponent(jobNumber)),
    isAdminOrManager
      ? supabase.rpc('get_org_members', { p_org_id: activeOrgId })
      : Promise.resolve({ data: null }),
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

  if (job.project?.id !== project.id) {
    return (
      <RouteRedirect href="/auftraege">
        <NestedJobDetailLoading />
      </RouteRedirect>
    );
  }

  const members: OrgMemberOption[] = (membersResult.data ?? []).map(
    (m: { user_id: string; first_name: string; last_name: string; role: string }) => ({
      userId: m.user_id,
      firstName: m.first_name,
      lastName: m.last_name,
      role: m.role,
    })
  );

  return (
    <JobDetailContent
      job={job}
      parentProject={{
        id: project.id,
        name: project.name,
        projectNumber: project.projectNumber!,
      }}
      members={members}
      isAdminOrManager={isAdminOrManager}
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
