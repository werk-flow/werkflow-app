'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { useActiveJobs } from '@/hooks/use-active-jobs';
import { getJobDisplayTitle, type Job, type Project, JOB_PRIORITY_LABELS } from '@/lib/jobs/types';
import { jobDetailHref } from '@/lib/jobs/routes';
import { formatGermanDate } from '@/lib/utils';
import { ActiveWorkIndicator } from '../list/unified-auftraege-display';
import { PRIORITY_CLASSES } from '../job-detail/job-detail-format';
import { getJobStatusClass, getJobStatusLabel } from '../status-classes';

type ProjectDetailChildJobsCardProps = {
  jobs: Job[];
  project: Pick<Project, 'id' | 'projectNumber'>;
  isAdminOrManager: boolean;
  onAssignJobs: () => void;
  /** The member read failed: a new job cannot be created until it loads. */
  membersFailed: boolean;
};

export function ProjectDetailChildJobsCard({
  jobs,
  project,
  isAdminOrManager,
  onAssignJobs,
  membersFailed,
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

      {membersFailed && (
        <RegionLoadError title="Die Mitarbeiterliste konnte nicht geladen werden" className="m-3">
          Neue Aufträge kannst du anlegen, sobald sie wieder geladen ist.
        </RegionLoadError>
      )}

      {jobs.length === 0 ? (
        <EmptyState size="compact" className="p-4" title="Noch keine Aufträge in diesem Projekt." />
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
            <Badge variant="secondary" className={getJobStatusClass(job)}>
              {getJobStatusLabel(job)}
            </Badge>
            <Badge variant="secondary" className={PRIORITY_CLASSES[job.priority]}>
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
