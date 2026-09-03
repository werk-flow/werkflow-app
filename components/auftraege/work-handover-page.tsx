import type { ReactElement } from 'react';

import { DetailPageHeader } from '@/components/shared/detail-page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import type { WorkHandoverWorkspace } from '@/lib/work-handover/types';
import { WorkHandoverSection } from './work-handover-section';

export function WorkHandoverPage({
  workspace,
}: {
  workspace: WorkHandoverWorkspace;
}): ReactElement {
  return (
    <PageShell className="bg-muted/20">
      <DetailPageHeader
        breadcrumbs={[
          { label: 'Aufträge', href: '/auftraege' },
          { label: 'Übergabeprüfung' },
        ]}
        title={workspace.targetSnapshot.title}
        subtitle={workspace.targetSnapshot.number
          ? `Übergabe ${workspace.targetSnapshot.number}`
          : 'Übergabeprüfung'}
      />
      <PageBody maxWidth="wide">
        <WorkHandoverSection initialWorkspace={workspace} />
      </PageBody>
    </PageShell>
  );
}
