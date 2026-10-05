'use client';

import { EmptyState } from '@/components/ui/empty-state';
import { Briefcase, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CreateJobDialog } from '@/components/auftraege/forms/create-job-dialog';
import { CreateAuftragProjectDialog } from '@/components/auftraege/forms/create-auftrag-project-dialog';
import type { Job, Client, ProjectWithDetails } from '@/lib/jobs/types';
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
  supportProjects?: ProjectWithDetails[];
  clientMap: Record<string, string>;
  jobAssignmentMap?: Record<string, string[]>;
  clients: Client[];
  members: OrgMemberOption[];
  isAdminOrManager: boolean;
  /** When set, the employee filter shows a locked, read-only field with this label. */
  lockedEmployeeLabel?: string;
  /** When set, the client filter shows a locked, read-only field with this label. */
  lockedClientLabel?: string;
  hideClientColumn?: boolean;
  defaultClientId?: string;
  defaultEmployeeIds?: string[];
  /** Makes the client field in create dialogs read-only. */
  readOnlyClient?: boolean;
  /** When true, project creation is hidden from the create dropdown. */
  hideProjectCreation?: boolean;
  /** Override projects list for create-job dialog (e.g. all active projects). */
  allProjectsForJobCreation?: ProjectWithDetails[];
  /** Hide empty project rows while still keeping support project metadata in the live graph. */
  hideEmptyProjects?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  visibleColumns: AuftraegeColumnId[];
}

export function EmbeddedAuftraegeSection({
  jobs: initialJobs,
  projects: initialProjects,
  supportProjects,
  clientMap,
  jobAssignmentMap: initialJobAssignmentMap = {},
  clients,
  members,
  isAdminOrManager,
  lockedEmployeeLabel,
  lockedClientLabel,
  hideClientColumn,
  defaultClientId,
  defaultEmployeeIds,
  readOnlyClient,
  hideProjectCreation,
  allProjectsForJobCreation,
  hideEmptyProjects = false,
  emptyTitle = 'Keine Aufträge',
  emptyDescription = 'Es sind keine Aufträge vorhanden.',
  visibleColumns,
}: EmbeddedAuftraegeSectionProps) {
  const listState = useEmbeddedAuftraegeListState();
  const entries = useEmbeddedAuftraegeEntries(listState, {
    initialJobs,
    initialProjects,
    supportProjects,
    clientMap,
    initialJobAssignmentMap,
    clients,
    allProjectsForJobCreation,
    hideEmptyProjects,
    visibleColumns,
  });
  const { createDialogOpen, setCreateDialogOpen, dialogProjectOptions, jobs } = entries;
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
          clients={clients}
          members={members}
          projects={dialogProjectOptions}
          defaultClientId={defaultClientId}
          defaultEmployeeIds={defaultEmployeeIds}
          readOnlyClient={readOnlyClient}
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onJobCreated={handleJobCreated}
        />
      ) : (
        <CreateAuftragProjectDialog
          clients={clients}
          members={members}
          projects={dialogProjectOptions}
          jobs={jobs}
          defaultClientId={defaultClientId}
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
      clients={clients}
      members={members}
      isAdminOrManager={isAdminOrManager}
      lockedEmployeeLabel={lockedEmployeeLabel}
      lockedClientLabel={lockedClientLabel}
      hideClientColumn={hideClientColumn}
      visibleColumns={visibleColumns}
    />
  );
}
