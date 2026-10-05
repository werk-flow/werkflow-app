import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { JOB_PRIORITY_LABELS, type Job, type ProjectStatus, type ProjectWithDetails } from '@/lib/jobs/types';
import { cn, formatGermanDate } from '@/lib/utils';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { AvatarStack } from './unified-auftraege-display';
import {
  getJobStatusClass,
  getJobStatusLabel,
  getProjectStatusClass,
  getProjectStatusLabel,
} from '../status-classes';
import { PRIORITY_CLASSES } from '../job-detail/job-detail-format';
import { TrafficLight } from '../project-detail/project-detail-status';

type UnifiedAuftraegeJobCardSummaryProps = {
  job: Job;
  clientName: string;
  memberLookup: Map<string, OrgMemberOption>;
  assignedUserIds: string[];
};

/** Customer, date, status, priority and assignees below a job card's title. */
export function UnifiedAuftraegeJobCardSummary({
  job,
  clientName,
  memberLookup,
  assignedUserIds,
}: UnifiedAuftraegeJobCardSummaryProps) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span className="truncate">{clientName}</span>
        {job.plannedDate && (
          <>
            <span className="text-muted-foreground/60">&middot;</span>
            <span>{formatGermanDate(job.plannedDate, { empty: '—' })}</span>
          </>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className={cn('text-[10px]', getJobStatusClass(job))}>
            {getJobStatusLabel(job)}
          </Badge>
          <Badge variant="secondary" className={cn('text-[10px]', PRIORITY_CLASSES[job.priority])}>
            {JOB_PRIORITY_LABELS[job.priority]}
          </Badge>
        </div>
        {assignedUserIds.length > 0 && (
          <AvatarStack userIds={assignedUserIds} memberLookup={memberLookup} max={3} />
        )}
      </div>
    </>
  );
}

type UnifiedAuftraegeProjectCardSummaryProps = {
  project: ProjectWithDetails;
  clientName: string;
  effectiveStatus: ProjectStatus;
  progress: number;
  trafficLight: 'green' | 'yellow' | 'red';
  expanded: boolean;
  allProjectUserIds: string[];
  memberLookup: Map<string, OrgMemberOption>;
};

/** Customer, period, status, progress and assignees below a project card's title. */
export function UnifiedAuftraegeProjectCardSummary({
  project,
  clientName,
  effectiveStatus,
  progress,
  trafficLight,
  expanded,
  allProjectUserIds,
  memberLookup,
}: UnifiedAuftraegeProjectCardSummaryProps) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span className="truncate">{clientName}</span>
        {(project.plannedStartDate || project.plannedEndDate) && (
          <>
            <span className="text-muted-foreground/60">&middot;</span>
            <span>
              {formatGermanDate(project.plannedStartDate, { empty: '—' })} –{' '}
              {formatGermanDate(project.plannedEndDate, { empty: '—' })}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="secondary"
            className={cn('text-[10px]', getProjectStatusClass(project, effectiveStatus))}
          >
            {getProjectStatusLabel(project)}
          </Badge>
          <div className="flex items-center gap-1.5">
            <Progress value={progress} className="h-1.5 w-12" />
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {project.completedJobCount}/{project.jobCount}
            </span>
          </div>
          <TrafficLight status={trafficLight} />
        </div>
        {!expanded && allProjectUserIds.length > 0 && (
          <AvatarStack userIds={allProjectUserIds} memberLookup={memberLookup} max={3} />
        )}
      </div>
    </>
  );
}
