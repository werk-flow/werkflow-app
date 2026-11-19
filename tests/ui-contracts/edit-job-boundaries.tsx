import { useState } from 'react';

import { EditJobDialog } from '@/components/auftraege/forms/edit-job-dialog';
import { JobDetailHeader } from '@/components/auftraege/job-detail/job-detail-header';
import { BannerProvider } from '@/components/ui/banner';
import type { JobWithDetails } from '@/lib/jobs/types';

const job: JobWithDetails = {
  id: '9a000000-0000-4000-8000-000000000155',
  organizationId: '9a000000-0000-4000-8000-0000000000a1',
  projectId: null,
  clientId: null,
  jobNumber: 'AUF-2026-155',
  title: 'Heizkörper entlüften',
  description: null,
  status: 'nicht_bearbeitet',
  executionState: 'not_started',
  executionVersion: 1,
  priority: 'mittel',
  plannedDate: null,
  plannedTime: null,
  estimatedDurationMinutes: null,
  plannedWorkingMinutes: null,
  actualCompletionDate: null,
  location: null,
  siteId: null,
  contactId: null,
  createdBy: '9a000000-0000-4000-8000-000000000001',
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-01T08:00:00.000Z',
  assignments: [],
  client: null,
  project: null,
};

/** The job page's header with its actions menu, and the edit dialog its „Bearbeiten“ opens. */
export function EditJobContractFixture(): React.JSX.Element {
  const [editOpen, setEditOpen] = useState(false);
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <JobDetailHeader
          liveJob={job}
          projectInfo={null}
          displayTitle={job.title}
          isJobActive={false}
          isAdminOrManager
          showEditDialog={editOpen}
          handleEditDialogOpenChange={setEditOpen}
          setShowDeleteDialog={() => undefined}
        />
        <EditJobDialog
          job={job}
          open={editOpen}
          onOpenChange={setEditOpen}
          selectedClient={null}
          members={[]}
          knownProject={undefined}
        />
      </main>
    </BannerProvider>
  );
}
