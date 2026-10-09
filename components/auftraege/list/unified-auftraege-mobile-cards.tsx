'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { PlainButton } from '@/components/ui/plain-button';
import { InlinePending } from '@/components/ui/inline-pending';
import { ListRow } from '@/components/ui/list-row';
import { jobDetailHref, projectDetailHref } from '@/lib/jobs/routes';
import {
  getJobDisplayTitle,
  getProjectDisplayTitle,
  type Job,
  type ProjectWithDetails,
} from '@/lib/jobs/types';
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
import { useUnifiedAuftraegeProjectEntry } from './use-unified-auftraege-project-entry';

type JobCardProps = UnifiedAuftraegeJobMenuProps & {
  job: Job;
  clientName: string;
  isAdminOrManager: boolean;
  indented?: boolean | undefined;
  /** The parent project of a child job; its route nests the job's. */
  project?: Pick<ProjectWithDetails, 'id' | 'projectNumber'> | undefined;
  isActive?: boolean | undefined;
  /** A draft the server has not confirmed: dimmed, not navigable, no actions. */
  isPending?: boolean | undefined;
  isSettling?: boolean | undefined;
  memberLookup: Map<string, OrgMemberOption>;
  assignedUserIds: string[];
};

function JobCard({
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
  projects,
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
            <span className="max-w-[55%] shrink-0 truncate font-mono text-[10px] text-muted-foreground">
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
        <div onClick={(e) => e.stopPropagation()}>
          <JobActionsMenu
            job={job}
            detailHref={detailHref}
            clientName={clientName}
            members={members}
            projects={projects}
            onJobUpdated={onJobUpdated}
            onJobDeleted={onJobDeleted}
            onDeleteRequested={onJobDeleteRequested}
          />
        </div>
      )}
    </ListRow>
  );
}

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

function ProjectCard({
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
  members,
  projects,
  onJobUpdated,
  onJobDeleted,
  onJobDeleteRequested,
  onProjectUpdated,
  onProjectDeleted,
  onProjectDeleteRequested,
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
  const { childPage, childJobs, clientMap, jobAssignmentMap } = entry;
  const isPending = rowFeedback.pendingIds.has(project.id);
  const projectHref = projectDetailHref(project);

  return (
    <div>
      <ListRow
        interactive={!isPending}
        unconfirmed={isPending || rowFeedback.settlingIds.has(project.id)}
        role={isPending ? 'status' : undefined}
        aria-label={isPending ? 'Wird gespeichert' : undefined}
        className={cn('items-start gap-2 bg-muted/30', isPending && 'opacity-70')}
        onClick={isPending ? undefined : () => router.push(projectHref)}
      >
        {isPending ? (
          <InlinePending active className="mt-0.5" />
        ) : (
          <PlainButton
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
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
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <SettlingIndicator active={rowFeedback.settlingIds.has(project.id)} />
            {project.projectNumber && (
              <span className="max-w-[55%] shrink-0 truncate font-mono text-[10px] text-muted-foreground">
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
        {isAdminOrManager && !isPending && (
          <div onClick={(e) => e.stopPropagation()}>
            <ProjectActionsMenu
              project={project}
              detailHref={projectHref}
              clientName={clientName}
              jobs={jobs}
              onProjectUpdated={onProjectUpdated}
              onProjectDeleted={onProjectDeleted}
              onDeleteRequested={onProjectDeleteRequested}
            />
          </div>
        )}
      </ListRow>

      {expanded && pagedChildren && <UnifiedAuftraegeChildPagination childPage={childPage} />}
      {expanded && childJobs.length > 0 && (
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
              members={members}
              projects={projects}
              onJobUpdated={onJobUpdated}
              onJobDeleted={onJobDeleted}
              onJobDeleteRequested={onJobDeleteRequested}
            />
          ))}
        </div>
      )}
    </div>
  );
}

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
