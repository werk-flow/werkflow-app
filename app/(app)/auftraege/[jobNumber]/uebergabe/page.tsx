import { redirect } from 'next/navigation';

import { WorkHandoverPage } from '@/components/auftraege/work-handover-page';
import { getWorkHandoverWorkspaceByNumber } from '@/lib/work-handover/actions';

export default async function StandaloneJobHandoverPage({
  params,
}: {
  params: Promise<{ jobNumber: string }>;
}) {
  const { jobNumber } = await params;
  const result = await getWorkHandoverWorkspaceByNumber({
    targetType: 'job', targetNumber: decodeURIComponent(jobNumber),
  });
  if (!result.success) redirect('/auftraege');
  return <WorkHandoverPage workspace={result.workspace} />;
}
