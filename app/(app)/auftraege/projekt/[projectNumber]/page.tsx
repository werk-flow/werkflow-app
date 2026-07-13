import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getProjectDocumentsOverview } from '@/lib/documents/actions';
import {
  getInventoryPickerOptions,
  getProjectMaterialSummary,
} from '@/lib/inventory/actions';
import { getProjectByNumber } from '@/lib/projects/actions';
import { toClient, type Client } from '@/lib/jobs/types';
import { ActionBanner } from '@/components/shared/action-banner';
import type { OrgRole } from '@/lib/members/actions';
import { ProjectDetailContent } from '@/components/auftraege/project-detail-content';
import { RouteRedirect } from '@/components/shared/route-redirect';
import ProjectDetailLoading from './loading';

interface ProjectDetailPageProps {
  params: Promise<{ projectNumber: string }>;
}

async function ProjectDetailData({
  projectNumber,
}: {
  projectNumber: string;
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
  const admin = createSupabaseAdminClient();

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
  const inventoryOptionsResultPromise = isAdminOrManager
    ? getInventoryPickerOptions()
    : Promise.resolve(null);

  const [result, clientsResult, documentsResult, materialResult, inventoryOptionsResult] = await Promise.all([
    projectResultPromise,
    admin
      .from('clients')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('name', { ascending: true }),
    documentsResultPromise,
    materialResultPromise,
    inventoryOptionsResultPromise,
  ]);

  if (!result.success) {
    return (
      <RouteRedirect href="/auftraege">
        <ProjectDetailLoading />
      </RouteRedirect>
    );
  }

  if (clientsResult.error) {
    console.error(
      `clients query failed for organization_id=${activeOrgId}`,
      clientsResult.error
    );
    throw new Error('Failed to load clients');
  }

  const { project, client, jobs, derivedStatus } = result.details;

  const clients: Client[] = (clientsResult.data ?? []).map(toClient);
  const projectDocuments =
    documentsResult && documentsResult.success ? documentsResult.projectDocuments : [];
  const jobDocumentGroups =
    documentsResult && documentsResult.success ? documentsResult.jobDocumentGroups : [];
  const materialSummary =
    materialResult && materialResult.success
      ? materialResult.summary
      : { directLines: [], jobGroups: [], totals: [] };
  const inventoryItems =
    inventoryOptionsResult && inventoryOptionsResult.success
      ? inventoryOptionsResult.items
      : [];
  const inventoryLocations =
    inventoryOptionsResult && inventoryOptionsResult.success
      ? inventoryOptionsResult.locations
      : [];

  return (
    <>
      <Suspense fallback={null}>
        <ActionBanner
          paramKey="deleted_job"
          messageTemplate='Auftrag „{name}" wurde erfolgreich gelöscht.'
        />
      </Suspense>
      <ProjectDetailContent
        project={project}
        client={client}
        jobs={jobs}
        availableJobs={[]}
        derivedStatus={derivedStatus}
        clients={clients}
        members={[]}
        isAdminOrManager={isAdminOrManager}
        projectDocuments={projectDocuments}
        jobDocumentGroups={jobDocumentGroups}
        materialSummary={materialSummary}
        inventoryItems={inventoryItems}
        inventoryLocations={inventoryLocations}
      />
    </>
  );
}

export default async function ProjectDetailPage({
  params,
}: ProjectDetailPageProps) {
  const { projectNumber } = await params;

  return <ProjectDetailData projectNumber={projectNumber} />;
}
