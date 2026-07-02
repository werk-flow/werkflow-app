import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getJobByNumber } from '@/lib/jobs/actions';
import { getJobInstructionItems } from '@/lib/jobs/instruction-items-actions';
import { getJobDocuments } from '@/lib/documents/actions';
import { getProjectByNumber } from '@/lib/projects/actions';
import { toClient } from '@/lib/jobs/types';
import { getOrgMembersForUser, type OrgRole } from '@/lib/members/actions';
import { createSupabaseServerClient } from '@/lib/supabase/server';
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
  const supabase = await createSupabaseServerClient();
  const jobResultPromise = getJobByNumber(decodeURIComponent(jobNumber));
  const instructionItemsResultPromise = jobResultPromise.then((result) =>
    result.success ? getJobInstructionItems(result.job.id) : null
  );
  const documentsResultPromise = jobResultPromise.then((result) =>
    result.success ? getJobDocuments(result.job.id) : null
  );

  const [
    projectResult,
    jobResult,
    membersResult,
    clientsResult,
    instructionItemsResult,
    documentsResult,
  ] = await Promise.all([
    getProjectByNumber(decodeURIComponent(projectNumber)),
    jobResultPromise,
    getOrgMembersForUser(activeOrgId, user.id),
    supabase
      .from('clients')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('name', { ascending: true }),
    instructionItemsResultPromise,
    documentsResultPromise,
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
      instructionItems={instructionItems}
      documents={documents}
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
