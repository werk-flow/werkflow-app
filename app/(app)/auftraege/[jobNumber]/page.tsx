import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getJobByNumber } from '@/lib/jobs/actions';
import { getJobInstructionItems } from '@/lib/jobs/instruction-items-actions';
import { toClient } from '@/lib/jobs/types';
import { getOrgMembersForUser, type OrgRole } from '@/lib/members/actions';
import { JobDetailContent } from '@/components/auftraege/job-detail-content';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
import { RouteRedirect } from '@/components/shared/route-redirect';
import JobDetailLoading from './loading';

interface JobDetailPageProps {
  params: Promise<{ jobNumber: string }>;
}

async function JobDetailData({ jobNumber }: { jobNumber: string }) {
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

  const [result, membersResult, clientsResult] = await Promise.all([
    getJobByNumber(decodeURIComponent(jobNumber)),
    getOrgMembersForUser(activeOrgId, user.id),
    admin
      .from('clients')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('name', { ascending: true }),
  ]);

  if (!result.success) {
    return (
      <RouteRedirect href="/auftraege">
        <JobDetailLoading />
      </RouteRedirect>
    );
  }

  const { job } = result;
  const instructionItemsResult = await getJobInstructionItems(job.id);
  const members: OrgMemberOption[] = membersResult.map((member) => ({
    userId: member.user_id,
    firstName: member.first_name,
    lastName: member.last_name,
    role: member.role,
  }));
  const clients = (clientsResult.data ?? []).map(toClient);

  if (job.project?.projectNumber) {
    redirect(
      `/auftraege/projekt/${encodeURIComponent(job.project.projectNumber)}/${encodeURIComponent(job.jobNumber!)}`
    );
  }

  return (
    <JobDetailContent
      job={job}
      clients={clients}
      members={members}
      projects={[]}
      isAdminOrManager={isAdminOrManager}
      instructionItems={instructionItemsResult.success ? instructionItemsResult.items : []}
      currentUserId={user.id}
    />
  );
}

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { jobNumber } = await params;

  return <JobDetailData jobNumber={jobNumber} />;
}
