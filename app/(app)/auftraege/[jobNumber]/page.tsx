import { redirect } from 'next/navigation';
import { readOrganizationClients } from '@/lib/clients/server';
import { cookies } from 'next/headers';
import { logError } from '@/lib/logging';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getJobByNumber } from '@/lib/jobs/actions';
import { getJobInstructionItems } from '@/lib/jobs/instruction-items-actions';
import { getJobDocuments } from '@/lib/documents/actions';
import { getInventoryPickerPage, getJobMaterialLines } from '@/lib/inventory/actions';
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
import { jobDetailHref } from '@/lib/jobs/routes';
import JobDetailLoading from './loading';

interface JobDetailPageProps {
  params: Promise<{ jobNumber: string }>;
}

async function JobDetailData({ jobNumber }: { jobNumber: string }) {
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
    return <FieldWorkPackPage jobNumber={jobNumber} currentUserId={user.id} />;
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

  // Origin request (P1-02): read through the RLS-enforced client, so only
  // managers (who may see requests) get the back-link.
  const originRequestPromise = jobResultPromise.then((result) =>
    result.success
      ? supabase
          .from('client_requests')
          .select('id, request_number, summary')
          .eq('converted_job_id', result.job.id)
          .maybeSingle()
      : null,
  );

  const [
    result,
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
    originRequest,
  ] = await Promise.all([
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
    originRequestPromise,
  ]);

  // A missing or forbidden job leaves the page; a failed read must not look like one.
  if (!result.success && (result.error === 'fetch_failed' || result.error === 'unexpected_error')) {
    return (
      <RegionLoadError title="Der Auftrag konnte nicht geladen werden">
        Der Auftrag ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }

  if (!result.success) {
    return (
      <RouteRedirect href="/auftraege">
        <JobDetailLoading />
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

  const { job } = result;
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
  if (job.project?.projectNumber) {
    redirect(jobDetailHref(job, job.project));
  }

  if (originRequest?.error) logError('Job detail: origin request read failed', originRequest.error);
  const originRequestRow = originRequest?.data ?? null;

  return (
    <JobDetailContent
      job={job}
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
      originRequest={
        originRequest?.error
          ? 'failed'
          : originRequestRow
            ? {
                label: originRequestRow.request_number
                  ? `Anfrage ${originRequestRow.request_number}`
                  : `Anfrage „${originRequestRow.summary}“`,
                href: `/anfragen/${originRequestRow.id}`,
              }
            : null
      }
      lifecycleSnapshot={lifecycleResult?.success ? lifecycleResult.snapshot : null}
      handoverWorkspace={handoverWorkspace}
    />
  );
}

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { jobNumber } = await params;

  return <JobDetailData jobNumber={jobNumber} />;
}
