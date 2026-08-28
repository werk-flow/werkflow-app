import { redirect } from 'next/navigation';

import { WorkHandoverPage } from '@/components/auftraege/work-handover-page';
import { getCachedUser } from '@/lib/data/cached';
import { getWorkHandoverWorkspace } from '@/lib/work-handover/actions';

export default async function ScopedWorkHandoverPage({
  params,
}: {
  params: Promise<{ targetType: string; targetId: string }>;
}) {
  const [{ data: { user } }, routeParams] = await Promise.all([getCachedUser(), params]);
  if (!user) redirect('/login');
  const targetType = routeParams.targetType === 'auftrag'
    ? 'job'
    : routeParams.targetType === 'projekt'
      ? 'project'
      : null;
  if (!targetType) redirect('/auftraege');
  const result = await getWorkHandoverWorkspace({
    targetType,
    targetId: routeParams.targetId,
  });
  if (!result.success) redirect('/auftraege');
  return <WorkHandoverPage workspace={result.workspace} />;
}
