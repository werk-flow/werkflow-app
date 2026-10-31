import { Suspense, type ComponentProps } from 'react';
import { getOrgMembersForUser } from '@/lib/members/queries';
import type { OrgMemberOption } from '@/components/auftraege/shared/employee-multi-select';
import type { OriginRequestLink } from '@/components/auftraege/shared/origin-request-line';
import { redirect } from 'next/navigation';
import { logError } from '@/lib/logging';

import { resolvePageMembership } from '@/lib/org/page-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isManagerRole } from '@/lib/roles';
import { getProjectDocumentsOverview } from '@/lib/documents/actions';
import { getInventoryPickerPage, getProjectMaterialSummary } from '@/lib/inventory/actions';
import { getProjectByNumber } from '@/lib/projects/actions';
import { UrlFlashBanner } from '@/components/ui/banner';
import { ProjectDetailContent } from '@/components/auftraege/project-detail/project-detail-content';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { RouteRedirect } from '@/components/shared/route-redirect';
import ProjectDetailLoading from './loading';
import { getWorkLifecycleSnapshot } from '@/lib/work-lifecycle/actions';
import { getWorkArtifacts } from '@/lib/work-artifacts/actions';
import { getProjectInstructionItems } from '@/lib/jobs/instruction-items-actions';
import { getEffectiveResponsibilityHolderForActor } from '@/lib/responsibilities/server';
import { getWorkHandoverWorkspace } from '@/lib/work-handover/actions';

interface ProjectDetailPageProps {
  params: Promise<{ projectNumber: string }>;
}

type ProjectDetailReadScope = {
  projectNumber: string;
  activeOrgId: string;
  userId: string;
  isAdminOrManager: boolean;
};

async function loadProjectDetailReads({
  projectNumber,
  activeOrgId,
  userId,
  isAdminOrManager,
}: ProjectDetailReadScope) {
  const projectResultPromise = getProjectByNumber(decodeURIComponent(projectNumber));
  const documentsResultPromise = projectResultPromise.then(async (result) => {
    if (!result.success) return null;
    return getProjectDocumentsOverview(result.details.project.id, result.details.jobs);
  });
  const materialResultPromise = isAdminOrManager
    ? projectResultPromise.then(async (result) => {
        if (!result.success) return null;
        return getProjectMaterialSummary(result.details.project.id);
      })
    : Promise.resolve(null);
  const inventoryOptionsResultPromise = isAdminOrManager ? getInventoryPickerPage() : Promise.resolve(null);
  const lifecycleResultPromise = projectResultPromise.then((result) =>
    result.success
      ? getWorkLifecycleSnapshot({ targetType: 'project', targetId: result.details.project.id })
      : null,
  );
  const artifactsResultPromise = projectResultPromise.then((result) =>
    result.success ? getWorkArtifacts({ targetType: 'project', targetId: result.details.project.id }) : null,
  );
  const instructionItemsResultPromise = projectResultPromise.then((result) =>
    result.success ? getProjectInstructionItems(result.details.project.id) : null,
  );
  const approvalHolderPromise = getEffectiveResponsibilityHolderForActor({
    organizationId: activeOrgId,
    responsibility: 'work_artifact_approval',
    actorUserId: userId,
  });
  const handoverWorkspacePromise = projectResultPromise.then((result) =>
    result.success
      ? getWorkHandoverWorkspace({
          targetType: 'project',
          targetId: result.details.project.id,
        })
      : null,
  );

  const [
    result,
    membersResult,
    documentsResult,
    materialResult,
    inventoryOptionsResult,
    lifecycleResult,
    artifactsResult,
    instructionItemsResult,
    approvalHolder,
    handoverWorkspaceResult,
  ] = await Promise.all([
    projectResultPromise,
    // The create-job dialog assigns employees; only managers open it.
    isAdminOrManager ? getOrgMembersForUser(activeOrgId, userId) : null,
    documentsResultPromise,
    materialResultPromise,
    inventoryOptionsResultPromise,
    lifecycleResultPromise,
    artifactsResultPromise,
    instructionItemsResultPromise,
    approvalHolderPromise,
    handoverWorkspacePromise,
  ]);
  return {
    result,
    membersResult,
    documentsResult,
    materialResult,
    inventoryOptionsResult,
    lifecycleResult,
    artifactsResult,
    instructionItemsResult,
    approvalHolder,
    handoverWorkspaceResult,
  };
}

type ProjectDetailReads = Awaited<ReturnType<typeof loadProjectDetailReads>>;
type ProjectDetailContentProps = ComponentProps<typeof ProjectDetailContent>;

/** The page regions fed by the project's secondary reads. */
function projectDetailRegions(
  {
    membersResult,
    documentsResult,
    materialResult,
    inventoryOptionsResult,
    lifecycleResult,
    artifactsResult,
    instructionItemsResult,
    approvalHolder,
    handoverWorkspaceResult,
  }: ProjectDetailReads,
  isAdminOrManager: boolean,
) {
  // Null: the manager's member read failed, and the jobs card shows the failure
  // instead of the create-job action. An employee never reads the members.
  const members: OrgMemberOption[] | null = !membersResult
    ? []
    : membersResult.success
      ? membersResult.members.map((member) => ({
          userId: member.user_id,
          firstName: member.first_name,
          lastName: member.last_name,
          role: member.role,
        }))
      : null;

  // A failed read stays null so that its region shows the failure instead of an empty list.
  // The instruction read is manager-only: an employee's refused read stays empty. The documents
  // read admits every caller who may open the project, so its failure shows for every role.
  const projectDocuments = documentsResult?.success ? documentsResult.projectDocuments : null;
  const instructionItems = instructionItemsResult?.success
    ? instructionItemsResult.items
    : isAdminOrManager
      ? null
      : [];
  const jobDocumentGroups = documentsResult?.success ? documentsResult.jobDocumentGroups : [];
  const materialSummary = materialResult?.success ? materialResult.summary : null;
  const inventoryItems = inventoryOptionsResult?.success ? inventoryOptionsResult.items : null;
  const inventoryLocations = inventoryOptionsResult?.success ? inventoryOptionsResult.locations : null;
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
    projectDocuments,
    jobDocumentGroups,
    materialSummary,
    inventoryItems,
    inventoryLocations,
    lifecycleSnapshot: lifecycleResult?.success ? lifecycleResult.snapshot : null,
    handoverWorkspace,
  } satisfies Partial<ProjectDetailContentProps>;
}

type OriginRequestScope = {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  activeOrgId: string;
  projectId: string;
  isAdminOrManager: boolean;
};

// Origin request (P1-02); the banner itself is manager-only in the component.
async function readProjectOriginRequest({
  admin,
  activeOrgId,
  projectId,
  isAdminOrManager,
}: OriginRequestScope): Promise<OriginRequestLink> {
  const { data: originRequestRow, error: originRequestError } = isAdminOrManager
    ? await admin
        .from('client_requests')
        .select('id, request_number, summary')
        .eq('organization_id', activeOrgId)
        .eq('converted_project_id', projectId)
        .maybeSingle()
    : { data: null, error: null };
  if (originRequestError) logError('Project detail: origin request read failed', originRequestError);

  return originRequestError
    ? 'failed'
    : originRequestRow
      ? {
          label: originRequestRow.request_number
            ? `Anfrage ${originRequestRow.request_number}`
            : `Anfrage „${originRequestRow.summary}“`,
          href: `/anfragen/${originRequestRow.id}`,
        }
      : null;
}

async function ProjectDetailData({ projectNumber }: { projectNumber: string }) {
  const { user, membership } = await resolvePageMembership();
  if (!membership) redirect('/auftraege');

  const activeOrgId = membership.orgId;
  const isAdminOrManager = isManagerRole(membership.role);
  const admin = createSupabaseAdminClient();

  const reads = await loadProjectDetailReads({
    projectNumber,
    activeOrgId,
    userId: user.id,
    isAdminOrManager,
  });
  const { result } = reads;

  // A missing or forbidden project leaves the page; a failed read must not look like one.
  if (!result.success && (result.error === 'load_failed' || result.error === 'unexpected_error')) {
    return (
      <RegionLoadError title="Das Projekt konnte nicht geladen werden">
        Das Projekt ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }

  if (!result.success) {
    return (
      <RouteRedirect href="/auftraege">
        <ProjectDetailLoading />
      </RouteRedirect>
    );
  }

  const regions = projectDetailRegions(reads, isAdminOrManager);
  const { project, client, jobs, derivedStatus } = result.details;
  const originRequest = await readProjectOriginRequest({
    admin,
    activeOrgId,
    projectId: project.id,
    isAdminOrManager,
  });

  return (
    <>
      <Suspense fallback={null}>
        <UrlFlashBanner
          paramKey="deleted_job"
          messageTemplate="Auftrag „{name}“ wurde erfolgreich gelöscht."
        />
      </Suspense>
      <ProjectDetailContent
        project={project}
        client={client}
        jobs={jobs}
        derivedStatus={derivedStatus}
        isAdminOrManager={isAdminOrManager}
        currentUserId={user.id}
        originRequest={originRequest}
        {...regions}
      />
    </>
  );
}

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { projectNumber } = await params;

  return <ProjectDetailData projectNumber={projectNumber} />;
}
