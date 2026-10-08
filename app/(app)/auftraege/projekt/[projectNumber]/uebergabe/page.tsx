import { WorkHandoverPage } from '@/components/auftraege/handover/work-handover-page';
import { getWorkHandoverWorkspaceByNumber } from '@/lib/work-handover/actions';

export default async function ProjectHandoverPage({
  params,
}: {
  params: Promise<{ projectNumber: string }>;
}) {
  const { projectNumber } = await params;
  const result = await getWorkHandoverWorkspaceByNumber({
    targetType: 'project',
    targetNumber: decodeURIComponent(projectNumber),
  });
  return <WorkHandoverPage result={result} />;
}
