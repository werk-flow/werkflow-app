import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getProjectByNumber } from '@/lib/projects/actions';
import { type Client } from '@/lib/jobs/types';
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

  const result = await getProjectByNumber(decodeURIComponent(projectNumber));

  if (!result.success) {
    return (
      <RouteRedirect href="/auftraege">
        <ProjectDetailLoading />
      </RouteRedirect>
    );
  }

  const { project, client, jobs, derivedStatus } = result.details;

  const clients: Client[] = client ? [client] : [];

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
