import { redirect } from 'next/navigation';

import { resolvePageMembership } from '@/lib/org/page-context';
import { getOrganizationUserPreferencesForView } from '@/lib/data/cached';
import { isManagerRole } from '@/lib/roles';
import { getClientDetail, getClientRelations } from '@/lib/clients/actions';
import { getClientSiteRoles } from '@/lib/clients/site-role-actions';
import { getClientDocuments } from '@/lib/documents/actions';
import { getJobsForClient } from '@/lib/jobs/actions';
import { getCustomerRelationshipBundle } from '@/lib/customer-relationships/actions';
import { getInstalledEquipmentForClient } from '@/lib/installed-equipment/actions';
import { getOrgMembersForUser } from '@/lib/members/queries';
import type { OrgMemberOption } from '@/components/auftraege/shared/employee-multi-select';
import { KundenDetailContent } from '@/components/kunden/kunden-detail-content';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { RouteRedirect } from '@/components/shared/route-redirect';
import { SiteAccessReviewOpener } from '@/components/kunden/site-access-review';
import { readSiteAccessReview } from '@/lib/site-access-proposals/review-read';
import { SITE_ACCESS_REVIEW_PARAM } from '@/lib/site-access-proposals/types';
import { uuidSchema } from '@/lib/validation/uuid';
import { logError } from '@/lib/logging';
import { readOfferPage } from '@/lib/offers/reads';
import KundenDetailLoading from './loading';

/** The newest offers the customer's page lists; a link opens the rest. */
const CUSTOMER_OFFER_COUNT = 5;

interface KundenDetailPageProps {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ [SITE_ACCESS_REVIEW_PARAM]?: string | string[] }>;
}

/** Every read of the customer detail page, started together. */
function readKundenDetail(clientId: string, activeOrgId: string, userId: string) {
  return Promise.all([
    getClientDetail(clientId),
    getClientRelations(clientId, { includeInactive: true }),
    getJobsForClient(clientId),
    getClientDocuments(clientId),
    getOrgMembersForUser(activeOrgId, userId),
    getCustomerRelationshipBundle(clientId),
    getInstalledEquipmentForClient(clientId),
    getOrganizationUserPreferencesForView(activeOrgId, userId),
    getClientSiteRoles(clientId),
    readOfferPage(activeOrgId, { status: null, search: '', clientId, page: 1 }, CUSTOMER_OFFER_COUNT).catch(
      (error: unknown) => {
        logError('kunde.offers_read_failed', error);
        return null;
      },
    ),
  ]);
}

function customerPageMember(member: {
  user_id: string;
  first_name: string;
  last_name: string;
  role: string;
}): OrgMemberOption {
  return {
    userId: member.user_id,
    firstName: member.first_name,
    lastName: member.last_name,
    role: member.role,
  };
}

async function KundenDetailData({ clientId }: { clientId: string }) {
  const { user, membership } = await resolvePageMembership();
  if (!membership) redirect('/kunden');

  const activeOrgId = membership.orgId;
  const isAdminOrManager = isManagerRole(membership.role);

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
    siteRolesResult,
    offers,
  ] = await readKundenDetail(clientId, activeOrgId, user.id);

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

  const { client, archivedAt, sourceNumber } = clientResult;

  return (
    <KundenDetailContent
      client={client}
      archivedAt={archivedAt}
      sourceNumber={sourceNumber}
      siteRoles={siteRolesResult.success ? siteRolesResult.roles : null}
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
      members={membersResult.members.map(customerPageMember)}
      isAdminOrManager={isAdminOrManager}
      visibleColumns={visibleColumns}
      currentUserId={user.id}
      relationshipBundle={relationshipResult.success ? relationshipResult.data : null}
      equipment={equipmentResult.success ? equipmentResult.equipment : []}
      equipmentLoadFailed={!equipmentResult.success}
      offers={offers}
    />
  );
}

/**
 * The review of a field worker's access proposal that a „Zugang prüfen“ task
 * links to with `?zugang=`. Without the parameter it reads nothing. It checks
 * the manager role itself and reads the proposal only inside the caller's
 * organization and this customer.
 */
async function SiteAccessReviewSlot({
  clientId,
  proposalParam,
}: {
  clientId: string;
  proposalParam: unknown;
}) {
  const proposalId = uuidSchema.safeParse(proposalParam);
  if (!proposalId.success) return null;
  const { membership } = await resolvePageMembership();
  if (!membership || !isManagerRole(membership.role)) return null;
  const result = await readSiteAccessReview(membership.orgId, clientId, proposalId.data);
  return <SiteAccessReviewOpener clientId={clientId} read={result.ok ? result.read : 'failed'} />;
}

export default async function KundenDetailPage({ params, searchParams }: KundenDetailPageProps) {
  const [{ clientId }, query] = await Promise.all([params, searchParams]);

  return (
    <>
      <KundenDetailData clientId={clientId} />
      <SiteAccessReviewSlot clientId={clientId} proposalParam={query[SITE_ACCESS_REVIEW_PARAM]} />
    </>
  );
}
