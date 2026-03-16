import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getJobByNumber } from '@/lib/jobs/actions';
import { toClient, type Client } from '@/lib/jobs/types';
import type { OrgRole } from '@/lib/members/actions';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
import { JobDetailContent } from '@/components/auftraege/job-detail-content';
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
    currentUserRole === 'admin' || currentUserRole === 'manager';

  const admin = createSupabaseAdminClient();
  const supabase = await createSupabaseServerClient();

  const [result, clientsResult, membersResult] = await Promise.all([
    getJobByNumber(decodeURIComponent(jobNumber)),
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

  if (!result.success) {
    return (
      <RouteRedirect href="/auftraege">
        <JobDetailLoading />
      </RouteRedirect>
    );
  }

  const { job } = result;

  if (job.project?.projectNumber) {
    redirect(
      `/auftraege/projekt/${encodeURIComponent(job.project.projectNumber)}/${encodeURIComponent(job.jobNumber!)}`
    );
  }

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
    <JobDetailContent
      job={job}
      clients={clients}
      members={members}
      isAdminOrManager={isAdminOrManager}
    />
  );
}

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { jobNumber } = await params;

  return <JobDetailData jobNumber={jobNumber} />;
}
