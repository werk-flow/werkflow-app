import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';

import { DetailPageHeader } from '@/components/shared/detail-page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { RegionLoadError } from '@/components/shared/region-load-error';
import type { ActionFailure } from '@/lib/action-result';
import type { WorkHandoverWorkspace } from '@/lib/work-handover/types';
import { WorkHandoverSection } from './work-handover-section';

// The handover is not there for this caller: a bad route value, a missing target,
// no handover review responsibility, or no session or organization.
const HANDOVER_ABSENT_CODES: ReadonlySet<string> = new Set([
  'invalid_input',
  'work_handover_target_not_found',
  'work_handover_not_authorized',
  'not_authenticated',
  'no_active_org',
]);

/** A handover route: the workspace, the job list for a missing handover, or the failed read with retry. */
export function WorkHandoverPage({
  result,
}: {
  result: { success: true; workspace: WorkHandoverWorkspace } | ActionFailure;
}): ReactElement {
  if (!result.success) {
    if (HANDOVER_ABSENT_CODES.has(result.error)) redirect('/auftraege');
    return (
      <RegionLoadError title="Die Übergabe konnte nicht geladen werden">
        Die Übergabeprüfung ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  const { workspace } = result;
  return (
    <PageShell className="bg-muted/20">
      <DetailPageHeader
        breadcrumbs={[{ label: 'Aufträge', href: '/auftraege' }, { label: 'Übergabeprüfung' }]}
        title={workspace.targetSnapshot.title}
        subtitle={
          workspace.targetSnapshot.number ? `Übergabe ${workspace.targetSnapshot.number}` : 'Übergabeprüfung'
        }
      />
      <PageBody maxWidth="wide">
        <WorkHandoverSection initialWorkspace={workspace} />
      </PageBody>
    </PageShell>
  );
}
