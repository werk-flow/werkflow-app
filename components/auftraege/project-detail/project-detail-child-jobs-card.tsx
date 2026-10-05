'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { useActiveJobs } from '@/hooks/use-active-jobs';
import { getJobDisplayTitle, type Job, type Project, JOB_PRIORITY_LABELS } from '@/lib/jobs/types';
import { jobDetailHref } from '@/lib/jobs/routes';
import { cn, formatGermanDate } from '@/lib/utils';
import { ActiveWorkIndicator } from '../list/unified-auftraege-display';
import { PRIORITY_CLASSES } from '../job-detail/job-detail-format';
import { getJobStatusClass, getJobStatusLabel } from '../status-classes';

type ProjectDetailChildJobsCardProps = {
  jobs: Job[];
  project: Pick<Project, 'id' | 'projectNumber'>;
  isAdminOrManager: boolean;
  onAssignJobs: () => void;
};

export function ProjectDetailChildJobsCard({
  jobs,
  project,
  isAdminOrManager,
  onAssignJobs,
}: ProjectDetailChildJobsCardProps) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">
          Aufträge in diesem Projekt <span className="text-muted-foreground">({jobs.length})</span>
        </h3>
        {isAdminOrManager && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => onAssignJobs()}>
            <Plus className="size-3" />
            Zuweisen
          </Button>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          Noch keine Aufträge in diesem Projekt.
        </div>
      ) : (
        <div className="space-y-2 p-3">
          {jobs.map((job) => (
            <ChildJobRow key={job.id} job={job} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChildJobRow({ job, project }: { job: Job; project: Pick<Project, 'id' | 'projectNumber'> }) {
  const { activeJobIds } = useActiveJobs();
  const href = jobDetailHref(job, project);

  return (
    <ListRow asChild interactive>
      <Link href={href}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{job.jobNumber}</span>
            <span className="text-sm font-medium inline-flex items-center min-w-0">
              <span className="line-clamp-2 break-words" title={getJobDisplayTitle(job)}>
                {getJobDisplayTitle(job)}
              </span>
              {activeJobIds.has(job.id) && <ActiveWorkIndicator />}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <Badge variant="secondary" className={cn('text-[10px]', getJobStatusClass(job))}>
              {getJobStatusLabel(job)}
            </Badge>
            <Badge variant="secondary" className={cn('text-[10px]', PRIORITY_CLASSES[job.priority])}>
              {JOB_PRIORITY_LABELS[job.priority]}
            </Badge>
            {job.plannedDate && (
              <span className="text-xs text-muted-foreground">
                {formatGermanDate(job.plannedDate, { empty: '—' })}
              </span>
            )}
          </div>
        </div>
      </Link>
    </ListRow>
  );
}
