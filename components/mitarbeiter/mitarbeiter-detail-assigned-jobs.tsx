'use client';

import { Briefcase } from 'lucide-react';

import { EmbeddedAuftraegeSection } from '@/components/shared/embedded-auftraege-section';
import type { MemberDetail } from '@/lib/members/actions';
import type { Job, ProjectWithDetails, Client } from '@/lib/jobs/types';
import type { AuftraegeColumnId } from '@/lib/jobs/auftraege-table-columns';
import type { OrgMemberOption } from '@/components/auftraege/shared/employee-multi-select';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SectionTitle } from '@/components/shared/section-title';

type MitarbeiterDetailAssignedJobsProps = {
  member: MemberDetail;
  /** `null` when the jobs failed to load. */
  jobs: Job[] | null;
  projects: ProjectWithDetails[];
  projectGraphProjects: ProjectWithDetails[];
  clientMap: Record<string, string>;
  jobAssignmentMap: Record<string, string[]>;
  clients: Client[];
  members: OrgMemberOption[];
  allProjects: ProjectWithDetails[];
  isAdminOrManager: boolean;
  visibleColumns: AuftraegeColumnId[];
};

/** Right column of the member detail page: the jobs assigned to the member. */
export function MitarbeiterDetailAssignedJobs({
  member,
  jobs,
  projects,
  projectGraphProjects,
  clientMap,
  jobAssignmentMap,
  clients,
  members,
  allProjects,
  isAdminOrManager,
  visibleColumns,
}: MitarbeiterDetailAssignedJobsProps) {
  return (
    <div className="space-y-4 md:col-span-3 2xl:col-span-1">
      <div className="flex items-center gap-2">
        <Briefcase className="size-4 text-muted-foreground" />
        <SectionTitle>Zugewiesene Aufträge</SectionTitle>
      </div>
      {jobs ? (
        <EmbeddedAuftraegeSection
          jobs={jobs}
          projects={projects}
          supportProjects={projectGraphProjects}
          clientMap={clientMap}
          jobAssignmentMap={jobAssignmentMap}
          clients={clients}
          members={members}
          lockedEmployeeLabel={`${member.firstName} ${member.lastName}`.trim()}
          defaultEmployeeIds={[member.userId]}
          isAdminOrManager={isAdminOrManager}
          hideProjectCreation
          hideEmptyProjects
          allProjectsForJobCreation={allProjects}
          visibleColumns={visibleColumns}
          emptyTitle="Keine Aufträge zugewiesen"
          emptyDescription="Diesem Mitarbeiter sind derzeit keine Aufträge zugewiesen."
        />
      ) : (
        <RegionLoadError>Aufträge konnten nicht geladen werden.</RegionLoadError>
      )}
    </div>
  );
}
