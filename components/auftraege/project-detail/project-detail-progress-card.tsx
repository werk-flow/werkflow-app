import { Progress } from '@/components/ui/progress';
import type { DerivedProjectStatus } from '@/lib/jobs/types';
import { TrafficLight } from './project-detail-status';
import { SectionTitle } from '@/components/shared/section-title';

type ProjectDetailProgressCardProps = {
  liveDerivedStatus: DerivedProjectStatus;
  completedCount: number;
  inProgressCount: number;
  jobCount: number;
};

export function ProjectDetailProgressCard({
  liveDerivedStatus,
  completedCount,
  inProgressCount,
  jobCount,
}: ProjectDetailProgressCardProps) {
  return (
    <div className="rounded-lg border bg-muted/30 p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <SectionTitle>Fortschritt</SectionTitle>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold tabular-nums">{liveDerivedStatus.progress}%</span>
          <TrafficLight status={liveDerivedStatus.trafficLight} />
        </div>
      </div>
      <Progress value={liveDerivedStatus.progress} className="mt-4 h-2.5" />
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>
          {completedCount} von {jobCount} Aufträgen abgeschlossen
        </span>
        {inProgressCount > 0 && <span>{inProgressCount} in Bearbeitung</span>}
      </div>
    </div>
  );
}
