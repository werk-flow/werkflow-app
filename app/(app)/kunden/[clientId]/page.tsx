import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import {
  getCachedMemberships,
  getCachedUser,
  getOrganizationUserPreferencesForView,
} from '@/lib/data/cached';
import { getClientDetail, getClientRelations } from '@/lib/clients/actions';
import { getClientDocuments } from '@/lib/documents/actions';
import { getJobsForClient } from '@/lib/jobs/actions';
import { getCustomerRelationshipBundle } from '@/lib/customer-relationships/actions';
import { getInstalledEquipmentForClient } from '@/lib/installed-equipment/actions';
import { type OrgRole } from '@/lib/members/actions';
import { getOrgMembersForUser } from '@/lib/members/queries';
import type { OrgMemberOption } from '@/components/auftraege/shared/employee-multi-select';
import { KundenDetailContent } from '@/components/kunden/kunden-detail-content';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { RouteRedirect } from '@/components/shared/route-redirect';
import KundenDetailLoading from './loading';

interface KundenDetailPageProps {
  params: Promise<{ clientId: string }>;
}

async function KundenDetailData({ clientId }: { clientId: string }) {
  const [
    {
      data: { user },
    },
    cookieStore,
  ] = await Promise.all([getCachedUser(), cookies()]);

  if (!user) redirect('/login');

  const [activeOrgId, memberships] = await Promise.all([
    resolveActiveOrgId(cookieStore, user.id),
    getCachedMemberships(user.id),
  ]);
  if (!activeOrgId) redirect('/kunden');

  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);
  const currentUserRole = currentMembership?.role as OrgRole | undefined;
  const isAdminOrManager = currentUserRole === 'admin' || currentUserRole === 'buero';

  if (!isAdminOrManager) {
    redirect('/dashboard');
  }

  const [
    clientResult,
    relationsResult,
    jobsResult,
    clientDocumentsResult,
    membersResult,
    relationshipResult,
    equipmentResult,
    { visibleColumns },
  ] = await Promise.all([
    getClientDetail(clientId),
    getClientRelations(clientId, { includeInactive: true }),
    getJobsForClient(clientId),
    getClientDocuments(clientId),
    getOrgMembersForUser(activeOrgId, user.id),
    getCustomerRelationshipBundle(clientId),
    getInstalledEquipmentForClient(clientId),
    getOrganizationUserPreferencesForView(activeOrgId, user.id),
  ]);

  // A missing or forbidden client leaves the page; a failed read must not look like one.
  if (
    !clientResult.success &&
    (clientResult.error === 'load_failed' || clientResult.error === 'unexpected_error')
  ) {
    return (
      <RegionLoadError title="Der Kunde konnte nicht geladen werden">
        Der Kunde ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }

  if (!clientResult.success) {
    return (
      <RouteRedirect href="/kunden">
        <KundenDetailLoading />
      </RouteRedirect>
    );
  }

  if (!membersResult.success) {
    return (
      <RegionLoadError title="Der Kunde konnte nicht geladen werden">
        Die Mitarbeiterliste ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }

  const { client } = clientResult;

  const members: OrgMemberOption[] = membersResult.members.map((m) => ({
    userId: m.user_id,
    firstName: m.first_name,
    lastName: m.last_name,
    role: m.role,
  }));

  return (
    <KundenDetailContent
      client={client}
      relations={
        relationsResult.success ? { contacts: relationsResult.contacts, sites: relationsResult.sites } : null
      }
      documents={clientDocumentsResult.success ? clientDocumentsResult.documents : null}
      linkedWork={
        jobsResult.success
          ? {
              jobs: jobsResult.jobs,
              projects: jobsResult.projects,
              clientMap: jobsResult.clientMap,
              jobAssignmentMap: jobsResult.jobAssignmentMap,
            }
          : null
      }
      members={members}
      isAdminOrManager={isAdminOrManager}
      visibleColumns={visibleColumns}
      currentUserId={user.id}
      relationshipBundle={relationshipResult.success ? relationshipResult.data : null}
      equipment={equipmentResult.success ? equipmentResult.equipment : []}
      equipmentLoadFailed={!equipmentResult.success}
    />
  );
}

export default async function KundenDetailPage({ params }: KundenDetailPageProps) {
  const { clientId } = await params;

  return <KundenDetailData clientId={clientId} />;
}
