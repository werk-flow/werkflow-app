import { redirect } from 'next/navigation';

import { WorkHandoverPage } from '@/components/auftraege/work-handover-page';
import { getWorkHandoverWorkspaceByNumber } from '@/lib/work-handover/actions';

export default async function ProjectJobHandoverPage({
  params,
}: {
  params: Promise<{ projectNumber: string; jobNumber: string }>;
}) {
  const { projectNumber, jobNumber } = await params;
  const result = await getWorkHandoverWorkspaceByNumber({
    targetType: 'job',
    targetNumber: decodeURIComponent(jobNumber),
    projectNumber: decodeURIComponent(projectNumber),
  });
  if (!result.success) redirect('/auftraege');
  return <WorkHandoverPage workspace={result.workspace} />;
}
