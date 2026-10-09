'use client';

import { Briefcase } from 'lucide-react';

import { EmbeddedAuftraegeSection } from '@/components/shared/embedded-auftraege-section';
import type { MemberDetail } from '@/lib/members/actions';
import type { Job, ProjectWithDetails } from '@/lib/jobs/types';
import type { AuftraegeColumnId } from '@/lib/jobs/auftraege-table-columns';
import type { OrgMemberOption } from '@/components/auftraege/shared/employee-multi-select';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SectionTitle } from '@/components/shared/section-title';

type MitarbeiterDetailAssignedJobsProps = {
  member: MemberDetail;
  /** `null` when the jobs failed to load. */
  jobs: Job[] | null;
  projects: ProjectWithDetails[];
  clientMap: Record<string, string>;
  jobAssignmentMap: Record<string, string[]>;
  members: OrgMemberOption[];
  isAdminOrManager: boolean;
  visibleColumns: AuftraegeColumnId[];
};

/** Right column of the member detail page: the jobs assigned to the member. */
export function MitarbeiterDetailAssignedJobs({
  member,
  jobs,
  projects,
  clientMap,
  jobAssignmentMap,
  members,
  isAdminOrManager,
  visibleColumns,
}: MitarbeiterDetailAssignedJobsProps) {
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-center gap-2">
        <Briefcase className="size-4 text-muted-foreground" />
        <SectionTitle>Zugewiesene Aufträge</SectionTitle>
      </div>
      {jobs ? (
        <EmbeddedAuftraegeSection
          jobs={jobs}
          projects={projects}
          clientMap={clientMap}
          jobAssignmentMap={jobAssignmentMap}
          members={members}
          lockedEmployeeLabel={`${member.firstName} ${member.lastName}`.trim()}
          defaultEmployeeIds={[member.userId]}
          isAdminOrManager={isAdminOrManager}
          hideProjectCreation
          hideEmptyProjects
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
