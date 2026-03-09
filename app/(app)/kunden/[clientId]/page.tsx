import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getClientDetail } from '@/lib/clients/actions';
import { getJobsForClient } from '@/lib/jobs/actions';
import { toClient, type Client } from '@/lib/jobs/types';
import type { OrgRole } from '@/lib/members/actions';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
import { KundenDetailContent } from '@/components/kunden/kunden-detail-content';

interface KundenDetailPageProps {
  params: Promise<{ clientId: string }>;
}

export default async function KundenDetailPage({
  params,
}: KundenDetailPageProps) {
  const { clientId } = await params;
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies(),
  ]);

  if (!user) redirect('/login');

  const activeOrgId = await resolveActiveOrgId(cookieStore, user.id);
  if (!activeOrgId) redirect('/kunden');

  const memberships = await getCachedMemberships(user.id);
  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);
  const currentUserRole = currentMembership?.role as OrgRole | undefined;
  const isAdminOrManager =
    currentUserRole === 'admin' || currentUserRole === 'manager';

  if (!isAdminOrManager) {
    redirect('/dashboard');
  }

  const [clientResult, jobsResult] = await Promise.all([
    getClientDetail(clientId),
    getJobsForClient(clientId),
  ]);

  if (!clientResult.success) notFound();

  const { client } = clientResult;

  const jobsData = jobsResult.success
    ? {
        jobs: jobsResult.jobs,
        projects: jobsResult.projects,
        clientMap: jobsResult.clientMap,
        jobAssignmentMap: jobsResult.jobAssignmentMap,
      }
    : { jobs: [], projects: [], clientMap: {}, jobAssignmentMap: {} };

  const admin = createSupabaseAdminClient();
  const supabase = await createSupabaseServerClient();

  const [clientsResult, membersResult] = await Promise.all([
    admin
      .from('clients')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('name', { ascending: true }),
    supabase.rpc('get_org_members', { p_org_id: activeOrgId }),
  ]);

  const allClients: Client[] = (clientsResult.data ?? []).map(toClient);
  const members: OrgMemberOption[] = (membersResult.data ?? []).map(
    (m: { user_id: string; first_name: string; last_name: string }) => ({
      userId: m.user_id,
      firstName: m.first_name,
      lastName: m.last_name,
    })
  );

  return (
    <KundenDetailContent
      client={client}
      jobs={jobsData.jobs}
      projects={jobsData.projects}
      clientMap={jobsData.clientMap}
      jobAssignmentMap={jobsData.jobAssignmentMap}
      clients={allClients}
      members={members}
      isAdminOrManager={isAdminOrManager}
    />
  );
}
