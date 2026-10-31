'use client';

import { memo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { PlainButton } from '@/components/ui/plain-button';
import { InlinePending } from '@/components/ui/inline-pending';
import { ListRow, ListRowActions } from '@/components/ui/list-row';
import { jobDetailHref, projectDetailHref } from '@/lib/jobs/routes';
import {
  getJobDisplayTitle,
  getProjectDisplayTitle,
  type Job,
  type ProjectWithDetails,
} from '@/lib/jobs/types';
import { memoPropsEqual } from '@/lib/ui/memo-equality';
import { cn } from '@/lib/utils';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { JobActionsMenu } from './job-actions-menu';
import { ProjectActionsMenu } from './project-actions-menu';
import {
  UnifiedAuftraegeJobCardSummary,
  UnifiedAuftraegeProjectCardSummary,
} from './unified-auftraege-card-summaries';
import { UnifiedAuftraegeChildPagination } from './unified-auftraege-desktop-rows';
import { ActiveWorkIndicator, SETTLING_LABEL, SettlingIndicator } from './unified-auftraege-display';
import type { AuftraegeRowFeedback, UnifiedAuftraegeEntryListProps } from './unified-auftraege-entry-list';
import { MarqueeText } from './unified-auftraege-marquee-text';
import type {
  UnifiedAuftraegeJobMenuProps,
  UnifiedAuftraegeProjectMenuProps,
} from './unified-auftraege-row-cells';
import { JOB_ROW_CONTENT_CHECKS, PROJECT_ROW_CONTENT_CHECKS } from './unified-auftraege-row-memo';
import { useUnifiedAuftraegeProjectEntry } from './use-unified-auftraege-project-entry';

type JobCardProps = UnifiedAuftraegeJobMenuProps & {
  job: Job;
  clientName: string;
  isAdminOrManager: boolean;
  indented?: boolean | undefined;
  /** The parent project of a child job; its route nests the job's. */
  project?: ProjectWithDetails | undefined;
  isActive?: boolean | undefined;
  /** A draft the server has not confirmed: dimmed, not navigable, no actions. */
  isPending?: boolean | undefined;
  isSettling?: boolean | undefined;
  memberLookup: Map<string, OrgMemberOption>;
  assignedUserIds: string[];
};

const JobCard = memo(function JobCard({
  job,
  clientName,
  isAdminOrManager,
  indented,
  project,
  isActive,
  isPending = false,
  isSettling = false,
  memberLookup,
  assignedUserIds,
  members,
  onJobUpdated,
  onJobDeleted,
  onJobDeleteRequested,
}: JobCardProps) {
  const router = useRouter();
  const detailHref = jobDetailHref(job, project);

  return (
    <ListRow
      interactive={!isPending}
      unconfirmed={isPending || isSettling}
      role={isPending ? 'status' : undefined}
      aria-label={isPending ? 'Wird gespeichert' : undefined}
      className={cn('items-start', indented && 'ml-6', isPending && 'opacity-70')}
      onClick={isPending ? undefined : () => router.push(detailHref)}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <InlinePending
            active={isPending || isSettling}
            label={isPending ? 'Wird gespeichert' : SETTLING_LABEL}
          />
          {job.jobNumber && (
            <span className="max-w-[55%] shrink-0 truncate font-mono text-xs text-muted-foreground">
              {job.jobNumber}
            </span>
          )}
          <MarqueeText className="flex-1 text-sm font-medium">
            {isPending ? (
              <span>{getJobDisplayTitle(job)}</span>
            ) : (
              <Link
                href={detailHref}
                className="inline-flex items-center rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(event) => event.stopPropagation()}
              >
                {getJobDisplayTitle(job)}
                {isActive && <ActiveWorkIndicator />}
              </Link>
            )}
          </MarqueeText>
        </div>
        <UnifiedAuftraegeJobCardSummary
          job={job}
          clientName={clientName}
          memberLookup={memberLookup}
          assignedUserIds={assignedUserIds}
        />
      </div>
      {isAdminOrManager && !isPending && (
        <ListRowActions>
          <JobActionsMenu
            job={job}
            detailHref={detailHref}
            clientName={clientName}
            members={members}
            knownProject={project}
            onJobUpdated={onJobUpdated}
            onJobDeleted={onJobDeleted}
            onDeleteRequested={onJobDeleteRequested}
          />
        </ListRowActions>
      )}
    </ListRow>
  );
}, memoPropsEqual<JobCardProps>(JOB_ROW_CONTENT_CHECKS));

type ProjectCardProps = UnifiedAuftraegeJobMenuProps &
  UnifiedAuftraegeProjectMenuProps & {
    project: ProjectWithDetails;
    childJobs: Job[];
    pagedChildren?: boolean | undefined;
    projectAssignedUserIds?: string[] | undefined;
    clientName: string;
    isAdminOrManager: boolean;
    clientMap: Record<string, string>;
    activeJobIds: Set<string>;
    rowFeedback: AuftraegeRowFeedback;
    memberLookup: Map<string, OrgMemberOption>;
    jobAssignmentMap: Record<string, string[]>;
  };

type ProjectCardToggleProps = {
  expanded: boolean;
  onToggle: () => void;
};

/** The expand toggle of a project card; a click on it never opens the project. */
function ProjectCardToggle({ expanded, onToggle }: ProjectCardToggleProps) {
  return (
    <PlainButton
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
      aria-label={expanded ? 'Projekt zuklappen' : 'Projekt aufklappen'}
      aria-expanded={expanded}
    >
      <ChevronRight
        className={cn(
          'size-3.5 text-muted-foreground transition-transform duration-200',
          expanded && 'rotate-90',
        )}
      />
    </PlainButton>
  );
}

type ProjectEntry = ReturnType<typeof useUnifiedAuftraegeProjectEntry>;

type ProjectCardBodyProps = Pick<ProjectCardProps, 'project' | 'clientName' | 'memberLookup'> & {
  entry: ProjectEntry;
  projectHref: string;
  isPending: boolean;
  isSettling: boolean;
  expanded: boolean;
};

/** A project card's number, linked title and summary. */
function ProjectCardBody({
  project,
  clientName,
  memberLookup,
  entry,
  projectHref,
  isPending,
  isSettling,
  expanded,
}: ProjectCardBodyProps) {
  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="flex items-center gap-2">
        <SettlingIndicator active={isSettling} />
        {project.projectNumber && (
          <span className="max-w-[55%] shrink-0 truncate font-mono text-xs text-muted-foreground">
            {project.projectNumber}
          </span>
        )}
        <MarqueeText className="flex-1 text-sm font-medium">
          {isPending ? (
            <span>{getProjectDisplayTitle(project)}</span>
          ) : (
            <Link
              href={projectHref}
              className="inline-flex items-center rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(event) => event.stopPropagation()}
            >
              {getProjectDisplayTitle(project)}
              {entry.hasActiveWork && <ActiveWorkIndicator />}
            </Link>
          )}
        </MarqueeText>
      </div>
      <UnifiedAuftraegeProjectCardSummary
        project={project}
        clientName={clientName}
        effectiveStatus={entry.effectiveStatus}
        progress={entry.progress}
        trafficLight={entry.trafficLight}
        expanded={expanded}
        allProjectUserIds={entry.allProjectUserIds}
        memberLookup={memberLookup}
      />
    </div>
  );
}

type ProjectCardHeaderProps = UnifiedAuftraegeProjectMenuProps &
  ProjectCardBodyProps &
  Pick<ProjectCardProps, 'isAdminOrManager'> & {
    onToggle: () => void;
    onOpen: (() => void) | undefined;
  };

/** The project's own card row, above its child job cards. */
function ProjectCardHeader({
  isAdminOrManager,
  onToggle,
  onOpen,
  jobs,
  onProjectUpdated,
  onProjectDeleted,
  onProjectDeleteRequested,
  ...bodyProps
}: ProjectCardHeaderProps) {
  const { project, projectHref, clientName, isPending, isSettling, expanded } = bodyProps;
  return (
    <ListRow
      interactive={!isPending}
      unconfirmed={isPending || isSettling}
      role={isPending ? 'status' : undefined}
      aria-label={isPending ? 'Wird gespeichert' : undefined}
      className={cn('items-start gap-2 bg-muted/30', isPending && 'opacity-70')}
      onClick={onOpen}
    >
      {isPending ? (
        <InlinePending active className="mt-0.5" />
      ) : (
        <ProjectCardToggle expanded={expanded} onToggle={onToggle} />
      )}
      <ProjectCardBody {...bodyProps} />
      {isAdminOrManager && !isPending && (
        <ListRowActions>
          <ProjectActionsMenu
            project={project}
            detailHref={projectHref}
            clientName={clientName}
            jobs={jobs}
            onProjectUpdated={onProjectUpdated}
            onProjectDeleted={onProjectDeleted}
            onDeleteRequested={onProjectDeleteRequested}
          />
        </ListRowActions>
      )}
    </ListRow>
  );
}

type ProjectCardChildJobsProps = UnifiedAuftraegeJobMenuProps &
  Pick<
    ProjectCardProps,
    'project' | 'clientName' | 'isAdminOrManager' | 'activeJobIds' | 'rowFeedback' | 'memberLookup'
  > & {
    entry: ProjectEntry;
  };

/** The indented child job cards of an expanded project card. */
function ProjectCardChildJobs({
  project,
  entry,
  clientName,
  isAdminOrManager,
  activeJobIds,
  rowFeedback,
  memberLookup,
  ...jobMenuProps
}: ProjectCardChildJobsProps) {
  const { childJobs, clientMap, jobAssignmentMap } = entry;
  return (
    <div className="mt-1 space-y-1">
      {childJobs.map((job) => (
        <JobCard
          key={job.id}
          job={job}
          clientName={job.clientId ? clientMap[job.clientId] || '—' : clientName}
          isAdminOrManager={isAdminOrManager}
          indented
          project={project}
          isActive={activeJobIds.has(job.id)}
          isPending={rowFeedback.pendingIds.has(job.id)}
          isSettling={rowFeedback.settlingIds.has(job.id)}
          memberLookup={memberLookup}
          assignedUserIds={jobAssignmentMap[job.id] ?? []}
          {...jobMenuProps}
        />
      ))}
    </div>
  );
}

const ProjectCard = memo(function ProjectCard({
  project,
  childJobs: initialChildJobs,
  pagedChildren = false,
  projectAssignedUserIds,
  clientName,
  isAdminOrManager,
  clientMap: initialClientMap,
  activeJobIds,
  rowFeedback,
  memberLookup,
  jobAssignmentMap: initialAssignmentMap,
  jobs,
  onProjectUpdated,
  onProjectDeleted,
  onProjectDeleteRequested,
  ...jobMenuProps
}: ProjectCardProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const entry = useUnifiedAuftraegeProjectEntry({
    project,
    expanded,
    initialChildJobs,
    pagedChildren,
    projectAssignedUserIds,
    initialClientMap,
    initialAssignmentMap,
    activeJobIds,
  });
  const isPending = rowFeedback.pendingIds.has(project.id);
  const projectHref = projectDetailHref(project);

  return (
    <div>
      <ProjectCardHeader
        project={project}
        entry={entry}
        projectHref={projectHref}
        clientName={clientName}
        memberLookup={memberLookup}
        isAdminOrManager={isAdminOrManager}
        isPending={isPending}
        isSettling={rowFeedback.settlingIds.has(project.id)}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        onOpen={isPending ? undefined : () => router.push(projectHref)}
        jobs={jobs}
        onProjectUpdated={onProjectUpdated}
        onProjectDeleted={onProjectDeleted}
        onProjectDeleteRequested={onProjectDeleteRequested}
      />

      {expanded && pagedChildren && <UnifiedAuftraegeChildPagination childPage={entry.childPage} />}
      {expanded && entry.childJobs.length > 0 && (
        <ProjectCardChildJobs
          project={project}
          entry={entry}
          clientName={clientName}
          isAdminOrManager={isAdminOrManager}
          activeJobIds={activeJobIds}
          rowFeedback={rowFeedback}
          memberLookup={memberLookup}
          {...jobMenuProps}
        />
      )}
    </div>
  );
}, memoPropsEqual<ProjectCardProps>(PROJECT_ROW_CONTENT_CHECKS));

/** The mobile card list: standalone jobs and projects with their expandable child jobs. */
export function UnifiedAuftraegeMobileCards({
  entries,
  pagedChildren,
  projectAssignmentMap,
  clientMap,
  isAdminOrManager,
  activeJobIds,
  rowFeedback,
  memberLookup,
  jobAssignmentMap,
  jobMenuProps,
  projectMenuProps,
}: UnifiedAuftraegeEntryListProps) {
  return (
    <div className="space-y-2 md:hidden">
      {entries.map((entry) => {
        if (entry.type === 'standalone-job') {
          return (
            <JobCard
              key={`job-${entry.job.id}`}
              job={entry.job}
              clientName={entry.job.clientId ? clientMap[entry.job.clientId] || '—' : '—'}
              isAdminOrManager={isAdminOrManager}
              isActive={activeJobIds.has(entry.job.id)}
              isPending={rowFeedback.pendingIds.has(entry.job.id)}
              isSettling={rowFeedback.settlingIds.has(entry.job.id)}
              memberLookup={memberLookup}
              assignedUserIds={jobAssignmentMap[entry.job.id] ?? []}
              {...jobMenuProps}
            />
          );
        }
        return (
          <ProjectCard
            key={`project-${entry.project.id}`}
            project={entry.project}
            childJobs={entry.childJobs}
            pagedChildren={pagedChildren}
            projectAssignedUserIds={projectAssignmentMap[entry.project.id]}
            clientName={entry.project.clientId ? clientMap[entry.project.clientId] || '—' : '—'}
            isAdminOrManager={isAdminOrManager}
            clientMap={clientMap}
            activeJobIds={activeJobIds}
            rowFeedback={rowFeedback}
            memberLookup={memberLookup}
            jobAssignmentMap={jobAssignmentMap}
            {...jobMenuProps}
            {...projectMenuProps}
          />
        );
      })}
    </div>
  );
}
