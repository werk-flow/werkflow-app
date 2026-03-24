import { Suspense } from 'react';
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
import KundenDetailLoading from './loading';

interface KundenDetailPageProps {
  params: Promise<{ clientId: string }>;
}

async function KundenDetailData({ clientId }: { clientId: string }) {
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
    currentUserRole === 'admin' || currentUserRole === 'buero';

  if (!isAdminOrManager) {
    redirect('/dashboard');
  }

  const admin = createSupabaseAdminClient();
  const supabase = await createSupabaseServerClient();

  const [clientResult, jobsResult, clientsResult, membersResult] = await Promise.all([
    getClientDetail(clientId),
    getJobsForClient(clientId),
    admin
      .from('clients')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('name', { ascending: true }),
    supabase.rpc('get_org_members', { p_org_id: activeOrgId }),
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

  const allClients: Client[] = (clientsResult.data ?? []).map(toClient);
  const members: OrgMemberOption[] = (membersResult.data ?? []).map(
    (m: { user_id: string; first_name: string; last_name: string; role: string }) => ({
      userId: m.user_id,
      firstName: m.first_name,
      lastName: m.last_name,
      role: m.role,
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

export default async function KundenDetailPage({
  params,
}: KundenDetailPageProps) {
  const { clientId } = await params;

  return (
    <Suspense fallback={<KundenDetailLoading />}>
      <KundenDetailData clientId={clientId} />
    </Suspense>
  );
}
