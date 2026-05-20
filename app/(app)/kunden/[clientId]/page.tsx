import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import {
  getCachedMemberships,
  getCachedOrganizationUserPreferences,
  getCachedUser,
} from '@/lib/data/cached';
import { getClientDetail } from '@/lib/clients/actions';
import { getJobsForClient } from '@/lib/jobs/actions';
import { toClient, type Client } from '@/lib/jobs/types';
import { getOrgMembersForUser, type OrgRole } from '@/lib/members/actions';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
import { KundenDetailContent } from '@/components/kunden/kunden-detail-content';
import { RouteRedirect } from '@/components/shared/route-redirect';
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

  const [clientResult, jobsResult, clientsResult, membersResult] = await Promise.all([
    getClientDetail(clientId),
    getJobsForClient(clientId),
    admin
      .from('clients')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('name', { ascending: true }),
    getOrgMembersForUser(activeOrgId, user.id),
  ]);

  if (!clientResult.success) {
    return (
      <RouteRedirect href="/kunden">
        <KundenDetailLoading />
      </RouteRedirect>
    );
  }

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
  const members: OrgMemberOption[] = membersResult.map(
    (m) => ({
      userId: m.user_id,
      firstName: m.first_name,
      lastName: m.last_name,
      role: m.role,
    })
  );
  const { visibleColumns } = await getCachedOrganizationUserPreferences(
    activeOrgId,
    user.id
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
      visibleColumns={visibleColumns}
    />
  );
}

export default async function KundenDetailPage({
  params,
}: KundenDetailPageProps) {
  const { clientId } = await params;

  return <KundenDetailData clientId={clientId} />;
}
