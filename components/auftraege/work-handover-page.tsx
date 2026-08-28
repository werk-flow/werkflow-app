import type { ReactElement } from 'react';

import { DetailPageHeader } from '@/components/shared/detail-page-header';
import type { WorkHandoverWorkspace } from '@/lib/work-handover/types';
import { WorkHandoverSection } from './work-handover-section';

export function WorkHandoverPage({
  workspace,
}: {
  workspace: WorkHandoverWorkspace;
}): ReactElement {
  return (
    <div className="min-h-full bg-muted/20">
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
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <WorkHandoverSection initialWorkspace={workspace} />
      </main>
    </div>
  );
}
