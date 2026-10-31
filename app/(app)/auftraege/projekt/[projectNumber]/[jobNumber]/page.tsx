import type { ComponentProps } from 'react';
import { redirect } from 'next/navigation';

import { resolvePageMembership } from '@/lib/org/page-context';
import { isManagerRole } from '@/lib/roles';
import { getJobByNumber } from '@/lib/jobs/actions';
import { getJobInstructionItems } from '@/lib/jobs/instruction-items-actions';
import { getJobDocuments } from '@/lib/documents/actions';
import { getInventoryPickerPage, getJobMaterialLines } from '@/lib/inventory/actions';
import { getProjectByNumber } from '@/lib/projects/actions';
import { getOrgMembersForUser } from '@/lib/members/queries';
import type { OrgMemberInfo } from '@/lib/members/actions';
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

type NestedJobDetailReadScope = {
  projectNumber: string;
  jobNumber: string;
  activeOrgId: string;
  userId: string;
};

async function loadNestedJobDetailReads({
  projectNumber,
  jobNumber,
  activeOrgId,
  userId,
}: NestedJobDetailReadScope) {
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
    actorUserId: userId,
  });
  const handoverWorkspacePromise = jobResultPromise.then((result) =>
    result.success ? getWorkHandoverWorkspace({ targetType: 'job', targetId: result.job.id }) : null,
  );

  const [
    projectResult,
    jobResult,
    membersResult,
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
    getOrgMembersForUser(activeOrgId, userId),
    instructionItemsResultPromise,
    documentsResultPromise,
    materialLinesResultPromise,
    inventoryOptionsResultPromise,
    lifecycleResultPromise,
    artifactsResultPromise,
    approvalHolderPromise,
    handoverWorkspacePromise,
  ]);
  return {
    projectResult,
    jobResult,
    membersResult,
    instructionItemsResult,
    documentsResult,
    materialLinesResult,
    inventoryOptionsResult,
    lifecycleResult,
    artifactsResult,
    approvalHolder,
    handoverWorkspaceResult,
  };
}

/** The page regions fed by the job's member list and secondary reads. */
function nestedJobDetailRegions(
  {
    instructionItemsResult,
    documentsResult,
    materialLinesResult,
    inventoryOptionsResult,
    lifecycleResult,
    artifactsResult,
    approvalHolder,
    handoverWorkspaceResult,
  }: Awaited<ReturnType<typeof loadNestedJobDetailReads>>,
  memberRows: readonly OrgMemberInfo[],
) {
  const members: OrgMemberOption[] = memberRows.map((member) => ({
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

  return {
    members,
    canApproveWorkArtifacts: Boolean(approvalHolder),
    instructionItems,
    initialArtifacts: artifactsResult?.success ? artifactsResult.artifacts : null,
    documents,
    materialLines,
    inventoryItems,
    inventoryLocations,
    lifecycleSnapshot: lifecycleResult?.success ? lifecycleResult.snapshot : null,
    handoverWorkspace,
  } satisfies Partial<ComponentProps<typeof JobDetailContent>>;
}

async function NestedJobDetailData({
  projectNumber,
  jobNumber,
}: {
  projectNumber: string;
  jobNumber: string;
}) {
  const { user, membership } = await resolvePageMembership();
  if (!membership) redirect('/auftraege');

  const activeOrgId = membership.orgId;
  const isAdminOrManager = isManagerRole(membership.role);
  if (!isAdminOrManager) {
    return (
      <FieldWorkPackPage
        jobNumber={jobNumber}
        expectedProjectNumber={projectNumber}
        currentUserId={user.id}
      />
    );
  }
  const reads = await loadNestedJobDetailReads({ projectNumber, jobNumber, activeOrgId, userId: user.id });
  const { projectResult, jobResult, membersResult } = reads;

  // A missing or forbidden job leaves the page; a failed read must not look like one.
  if (!jobResult.success && (jobResult.error === 'fetch_failed' || jobResult.error === 'unexpected_error')) {
    return (
      <RegionLoadError title="Der Auftrag konnte nicht geladen werden">
        Der Auftrag ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }

  if (
    !projectResult.success &&
    (projectResult.error === 'load_failed' || projectResult.error === 'unexpected_error')
  ) {
    return (
      <RegionLoadError title="Das Projekt konnte nicht geladen werden">
        Das Projekt ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
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
  const regions = nestedJobDetailRegions(reads, membersResult.members);
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
      isAdminOrManager={isAdminOrManager}
      currentUserId={user.id}
      {...regions}
    />
  );
}

export default async function NestedJobDetailPage({ params }: NestedJobDetailPageProps) {
  const { projectNumber, jobNumber } = await params;

  return <NestedJobDetailData projectNumber={projectNumber} jobNumber={jobNumber} />;
}
