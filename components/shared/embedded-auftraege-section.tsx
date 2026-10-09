'use client';

import { EmptyState } from '@/components/ui/empty-state';
import { Briefcase, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CreateJobDialog } from '@/components/auftraege/forms/create-job-dialog';
import { CreateAuftragProjectDialog } from '@/components/auftraege/forms/create-auftrag-project-dialog';
import type { Job, ProjectWithDetails } from '@/lib/jobs/types';
import type { ClientSelectItem } from '@/components/auftraege/shared/client-select-with-create';
import type { AuftraegeColumnId } from '@/lib/jobs/auftraege-table-columns';
import type { OrgMemberOption } from '@/components/auftraege/shared/employee-multi-select';
import { EmbeddedAuftraegeLists } from '@/components/shared/embedded-auftraege-lists';
import { useEmbeddedAuftraegeMutations } from '@/components/shared/use-embedded-auftraege-mutations';
import {
  useEmbeddedAuftraegeEntries,
  useEmbeddedAuftraegeListState,
  useEmbeddedAuftraegeSortHandlers,
} from '@/components/shared/use-embedded-auftraege-state';

interface EmbeddedAuftraegeSectionProps {
  jobs: Job[];
  projects: ProjectWithDetails[];
  clientMap: Record<string, string>;
  jobAssignmentMap?: Record<string, string[]>;
  members: OrgMemberOption[];
  isAdminOrManager: boolean;
  /** When set, the employee filter shows a locked, read-only field with this label. */
  lockedEmployeeLabel?: string;
  /** When set, the client filter shows a locked, read-only field with this label. */
  lockedClientLabel?: string;
  hideClientColumn?: boolean;
  /** The customer new work starts with, as the page shows it. */
  defaultClient?: ClientSelectItem;
  defaultEmployeeIds?: string[];
  /** Makes the client field in create dialogs read-only. */
  readOnlyClient?: boolean;
  /** When true, project creation is hidden from the create dropdown. */
  hideProjectCreation?: boolean;
  /** Hide project rows without a listed job. */
  hideEmptyProjects?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  visibleColumns: AuftraegeColumnId[];
}

export function EmbeddedAuftraegeSection({
  jobs: initialJobs,
  projects: initialProjects,
  clientMap,
  jobAssignmentMap: initialJobAssignmentMap = {},
  members,
  isAdminOrManager,
  lockedEmployeeLabel,
  lockedClientLabel,
  hideClientColumn,
  defaultClient,
  defaultEmployeeIds,
  readOnlyClient,
  hideProjectCreation,
  hideEmptyProjects = false,
  emptyTitle = 'Keine Aufträge',
  emptyDescription = 'Es sind keine Aufträge vorhanden.',
  visibleColumns,
}: EmbeddedAuftraegeSectionProps) {
  const listState = useEmbeddedAuftraegeListState();
  const entries = useEmbeddedAuftraegeEntries(listState, {
    initialJobs,
    initialProjects,
    clientMap,
    initialJobAssignmentMap,
    hideEmptyProjects,
    visibleColumns,
  });
  const { createDialogOpen, setCreateDialogOpen, jobs } = entries;
  const mutations = useEmbeddedAuftraegeMutations(
    entries.setJobs,
    entries.setRawProjects,
    entries.setJobAssignmentMap,
  );
  const { handleJobCreated, handleProjectCreated } = mutations;
  const sortHandlers = useEmbeddedAuftraegeSortHandlers(listState);

  const createButton = isAdminOrManager ? (
    hideProjectCreation ? (
      <Button size="sm" className="gap-1.5" onClick={() => setCreateDialogOpen(true)}>
        <Plus className="size-3.5" />
        <span className="sr-only sm:not-sr-only">Auftrag erstellen</span>
      </Button>
    ) : (
      <Button size="sm" className="gap-1.5" onClick={() => setCreateDialogOpen(true)}>
        <Plus className="size-3.5" />
        <span className="sr-only sm:not-sr-only">Erstellen</span>
      </Button>
    )
  ) : null;

  const createDialogs = isAdminOrManager ? (
    <>
      {hideProjectCreation ? (
        <CreateJobDialog
          members={members}
          defaultClient={defaultClient}
          defaultEmployeeIds={defaultEmployeeIds}
          readOnlyClient={readOnlyClient}
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onJobCreated={handleJobCreated}
        />
      ) : (
        <CreateAuftragProjectDialog
          members={members}
          jobs={jobs}
          defaultClient={defaultClient}
          defaultEmployeeIds={defaultEmployeeIds}
          readOnlyClient={readOnlyClient}
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onJobCreated={handleJobCreated}
          onProjectCreated={handleProjectCreated}
        />
      )}
    </>
  ) : null;

  if (entries.unifiedEntries.length === 0) {
    return (
      <>
        <EmptyState
          icon={Briefcase}
          title={emptyTitle}
          description={emptyDescription}
          action={isAdminOrManager ? createButton : undefined}
          className="rounded-lg border border-dashed bg-card"
        />
        {createDialogs}
      </>
    );
  }

  return (
    <EmbeddedAuftraegeLists
      listState={listState}
      entries={entries}
      sortHandlers={sortHandlers}
      mutations={mutations}
      createButton={createButton}
      createDialogs={createDialogs}
      clientMap={clientMap}
      members={members}
      isAdminOrManager={isAdminOrManager}
      lockedEmployeeLabel={lockedEmployeeLabel}
      lockedClientLabel={lockedClientLabel}
      hideClientColumn={hideClientColumn}
      visibleColumns={visibleColumns}
    />
  );
}
