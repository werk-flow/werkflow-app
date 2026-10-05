import { redirect } from 'next/navigation';
import { readOrganizationClients } from '@/lib/clients/server';
import { cookies } from 'next/headers';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getJobByNumber } from '@/lib/jobs/actions';
import { getJobInstructionItems } from '@/lib/jobs/instruction-items-actions';
import { getJobDocuments } from '@/lib/documents/actions';
import { getInventoryPickerPage, getJobMaterialLines } from '@/lib/inventory/actions';
import { getProjectByNumber } from '@/lib/projects/actions';
import { type OrgRole } from '@/lib/members/actions';
import { getOrgMembersForUser } from '@/lib/members/queries';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { JobDetailContent } from '@/components/auftraege/job-detail/job-detail-content';
import { FieldWorkPackPage } from '@/components/auftraege/work-pack/field-work-pack-page';
import type { OrgMemberOption } from '@/components/auftraege/shared/employee-multi-select';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { RouteRedirect } from '@/components/shared/route-redirect';
import { getWorkLifecycleSnapshot } from '@/lib/work-lifecycle/actions';
import { getWorkArtifacts } from '@/lib/work-artifacts/actions';
import { getEffectiveResponsibilityHolderForActor } from '@/lib/responsibilities/server';
import { getWorkHandoverWorkspace } from '@/lib/work-handover/actions';
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
  if (!activeOrgId) redirect('/auftraege');

  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);
  const currentUserRole = currentMembership?.role as OrgRole | undefined;
  const isAdminOrManager = currentUserRole === 'admin' || currentUserRole === 'buero';
  if (!isAdminOrManager) {
    return (
      <FieldWorkPackPage
        jobNumber={jobNumber}
        expectedProjectNumber={projectNumber}
        currentUserId={user.id}
      />
    );
  }
  const supabase = await createSupabaseServerClient();
  const jobResultPromise = getJobByNumber(decodeURIComponent(jobNumber));
  const instructionItemsResultPromise = jobResultPromise.then((result) =>
    result.success ? getJobInstructionItems(result.job.id) : null,
  );
  const documentsResultPromise = jobResultPromise.then((result) =>
    result.success ? getJobDocuments(result.job.id) : null,
  );
  const materialLinesResultPromise = jobResultPromise.then((result) =>
    result.success ? getJobMaterialLines(result.job.id) : null,
  );
  const inventoryOptionsResultPromise = getInventoryPickerPage();
  const lifecycleResultPromise = jobResultPromise.then((result) =>
    result.success ? getWorkLifecycleSnapshot({ targetType: 'job', targetId: result.job.id }) : null,
  );
  const artifactsResultPromise = jobResultPromise.then((result) =>
    result.success ? getWorkArtifacts({ targetType: 'job', targetId: result.job.id }) : null,
  );
  const approvalHolderPromise = getEffectiveResponsibilityHolderForActor({
    organizationId: activeOrgId,
    responsibility: 'work_artifact_approval',
    actorUserId: user.id,
  });
  const handoverWorkspacePromise = jobResultPromise.then((result) =>
    result.success ? getWorkHandoverWorkspace({ targetType: 'job', targetId: result.job.id }) : null,
  );

  const [
    projectResult,
    jobResult,
    membersResult,
    clients,
    instructionItemsResult,
    documentsResult,
    materialLinesResult,
    inventoryOptionsResult,
    lifecycleResult,
    artifactsResult,
    approvalHolder,
    handoverWorkspaceResult,
  ] = await Promise.all([
    getProjectByNumber(decodeURIComponent(projectNumber)),
    jobResultPromise,
    getOrgMembersForUser(activeOrgId, user.id),
    readOrganizationClients(supabase, activeOrgId),
    instructionItemsResultPromise,
    documentsResultPromise,
    materialLinesResultPromise,
    inventoryOptionsResultPromise,
    lifecycleResultPromise,
    artifactsResultPromise,
    approvalHolderPromise,
    handoverWorkspacePromise,
  ]);

  // A missing or forbidden job leaves the page; a failed read must not look like one.
  if (!jobResult.success && (jobResult.error === 'fetch_failed' || jobResult.error === 'unexpected_error')) {
    return (
      <RegionLoadError title="Der Auftrag konnte nicht geladen werden">
        Der Auftrag ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }

  if (!projectResult.success || !jobResult.success) {
    return (
      <RouteRedirect href="/auftraege">
        <NestedJobDetailLoading />
      </RouteRedirect>
    );
  }

  if (!membersResult.success) {
    return (
      <RegionLoadError title="Der Auftrag konnte nicht geladen werden">
        Die Mitarbeiterliste ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }

  const { project } = projectResult.details;
  const { job } = jobResult;
  const members: OrgMemberOption[] = membersResult.members.map((member) => ({
    userId: member.user_id,
    firstName: member.first_name,
    lastName: member.last_name,
    role: member.role,
  }));

  // A failed read stays null so that its region shows the failure instead of an empty list.
  const instructionItems = instructionItemsResult?.success ? instructionItemsResult.items : null;
  const documents = documentsResult?.success ? documentsResult.documents : null;
  const materialLines = materialLinesResult?.success ? materialLinesResult.lines : null;
  const inventoryItems = inventoryOptionsResult.success ? inventoryOptionsResult.items : null;
  const inventoryLocations = inventoryOptionsResult.success ? inventoryOptionsResult.locations : null;
  // Only a holder of the handover review may read the workspace; for everyone else the summary stays hidden.
  const handoverWorkspace = handoverWorkspaceResult?.success
    ? handoverWorkspaceResult.workspace
    : handoverWorkspaceResult?.error === 'work_handover_not_authorized'
      ? 'not_reviewer'
      : null;
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
        projectNumber: project.projectNumber,
      }}
      clients={clients}
      members={members}
      projects={[]}
      isAdminOrManager={isAdminOrManager}
      canApproveWorkArtifacts={Boolean(approvalHolder)}
      instructionItems={instructionItems}
      initialArtifacts={artifactsResult?.success ? artifactsResult.artifacts : null}
      documents={documents}
      materialLines={materialLines}
      inventoryItems={inventoryItems}
      inventoryLocations={inventoryLocations}
      currentUserId={user.id}
      lifecycleSnapshot={lifecycleResult?.success ? lifecycleResult.snapshot : null}
      handoverWorkspace={handoverWorkspace}
    />
  );
}

export default async function NestedJobDetailPage({ params }: NestedJobDetailPageProps) {
  const { projectNumber, jobNumber } = await params;

  return <NestedJobDetailData projectNumber={projectNumber} jobNumber={jobNumber} />;
}
