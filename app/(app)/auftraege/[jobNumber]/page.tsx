import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getJobByNumber } from '@/lib/jobs/actions';
import { getJobInstructionItems } from '@/lib/jobs/instruction-items-actions';
import { getJobDocuments } from '@/lib/documents/actions';
import { getInventoryPickerOptions, getJobMaterialLines } from '@/lib/inventory/actions';
import { toClient } from '@/lib/jobs/types';
import { getOrgMembersForUser, type OrgRole } from '@/lib/members/actions';
import { createSupabaseServerClient } from '@/lib/supabase/server';
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
  const supabase = await createSupabaseServerClient();
  const jobResultPromise = getJobByNumber(decodeURIComponent(jobNumber));
  const instructionItemsResultPromise = jobResultPromise.then((result) =>
    result.success ? getJobInstructionItems(result.job.id) : null
  );
  const documentsResultPromise = jobResultPromise.then((result) =>
    result.success ? getJobDocuments(result.job.id) : null
  );
  const materialLinesResultPromise = jobResultPromise.then((result) =>
    result.success ? getJobMaterialLines(result.job.id) : null
  );
  const inventoryOptionsResultPromise = getInventoryPickerOptions();

  const [
    result,
    membersResult,
    clientsResult,
    instructionItemsResult,
    documentsResult,
    materialLinesResult,
    inventoryOptionsResult,
  ] = await Promise.all([
    jobResultPromise,
    getOrgMembersForUser(activeOrgId, user.id),
    supabase
      .from('clients')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('name', { ascending: true }),
    instructionItemsResultPromise,
    documentsResultPromise,
    materialLinesResultPromise,
    inventoryOptionsResultPromise,
  ]);

  if (!result.success) {
    return (
      <RouteRedirect href="/auftraege">
        <JobDetailLoading />
      </RouteRedirect>
    );
  }

  const { job } = result;
  const members: OrgMemberOption[] = membersResult.map((member) => ({
    userId: member.user_id,
    firstName: member.first_name,
    lastName: member.last_name,
    role: member.role,
  }));

  if (clientsResult.error) {
    console.error(
      `clients query failed for organization_id=${activeOrgId}`,
      clientsResult.error
    );
    throw new Error(
      `Failed to load clients: ${clientsResult.error.message ?? 'unknown error'}`
    );
  }

  const clients = (clientsResult.data ?? []).map(toClient);
  const instructionItems =
    instructionItemsResult && instructionItemsResult.success
      ? instructionItemsResult.items
      : [];
  const documents =
    documentsResult && documentsResult.success ? documentsResult.documents : [];
  const materialLines =
    materialLinesResult && materialLinesResult.success
      ? materialLinesResult.lines
      : [];
  const inventoryItems =
    inventoryOptionsResult && inventoryOptionsResult.success
      ? inventoryOptionsResult.items
      : [];
  const inventoryLocations =
    inventoryOptionsResult && inventoryOptionsResult.success
      ? inventoryOptionsResult.locations
      : [];

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
      instructionItems={instructionItems}
      documents={documents}
      materialLines={materialLines}
      inventoryItems={inventoryItems}
      inventoryLocations={inventoryLocations}
      currentUserId={user.id}
    />
  );
}

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { jobNumber } = await params;

  return <JobDetailData jobNumber={jobNumber} />;
}
