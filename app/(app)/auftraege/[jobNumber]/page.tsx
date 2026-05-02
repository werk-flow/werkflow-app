import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getJobByNumber } from '@/lib/jobs/actions';
import type { OrgRole } from '@/lib/members/actions';
import { JobDetailContent } from '@/components/auftraege/job-detail-content';
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

  const result = await getJobByNumber(decodeURIComponent(jobNumber));

  if (!result.success) {
    return (
      <RouteRedirect href="/auftraege">
        <JobDetailLoading />
      </RouteRedirect>
    );
  }

  const { job } = result;

  if (job.project?.projectNumber) {
    redirect(
      `/auftraege/projekt/${encodeURIComponent(job.project.projectNumber)}/${encodeURIComponent(job.jobNumber!)}`
    );
  }

  return (
    <JobDetailContent
      job={job}
      clients={[]}
      members={[]}
      projects={[]}
      isAdminOrManager={isAdminOrManager}
    />
  );
}

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { jobNumber } = await params;

  return <JobDetailData jobNumber={jobNumber} />;
}
