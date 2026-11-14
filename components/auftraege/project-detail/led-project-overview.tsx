'use client';

import { useState, type ReactElement } from 'react';
import { CheckCircle2, Circle, UserRoundCheck } from 'lucide-react';

import { DetailPageHeader } from '@/components/shared/detail-page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SectionTitle } from '@/components/shared/section-title';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import type { LedJob, LedProjectOverview } from '@/lib/projects/work-lead-types';
import { formatGermanDate } from '@/lib/utils';
import { WORK_EXECUTION_LABELS } from '@/lib/work-lifecycle/types';
import { WorkArtifactsSection } from '../artifacts/work-artifacts-section';
import { WORK_EXECUTION_CLASSES } from '../status-classes';

type LeadViewer = {
  currentUserId: string;
  /** The viewer holds the organization's approval responsibility besides leading. */
  canApprove: boolean;
};

/**
 * The project page of a „Projektleitung“ who works on none of its jobs: the
 * project's own Arbeitsnachweise and every job they lead.
 */
export function LedProjectPage({
  overview,
  ...viewer
}: LeadViewer & { overview: LedProjectOverview }): ReactElement {
  return (
    <PageShell>
      <DetailPageHeader
        breadcrumbs={[
          { label: 'Aufträge', href: '/auftraege' },
          { label: overview.projectNumber ?? 'Projekt' },
        ]}
        title={overview.name}
        subtitle="Du bist die Projektleitung."
      />
      <PageBody className="space-y-6">
        <WorkArtifactsSection
          refreshOnLeadSignal
          targetType="project"
          targetId={overview.projectId}
          initialArtifacts={overview.projectArtifacts}
          isManager={false}
          canApprove={viewer.canApprove}
          currentUserId={viewer.currentUserId}
          documents={[]}
          readOnly
        />
        <LedJobsSection overview={overview} {...viewer} />
      </PageBody>
    </PageShell>
  );
}

/**
 * Every job of the project its „Projektleitung“ leads, in the lead's
 * projection: scope, instructions and Arbeitsnachweise, no price, cost or
 * customer record. A failed read shows its retry.
 */
export function LedJobsSection({
  overview,
  currentUserId,
  canApprove,
}: LeadViewer & { overview: LedProjectOverview | 'failed' }): ReactElement {
  // The lead reads no row of a job they are not on: a change of the project's
  // jobs, instructions and Arbeitsnachweise touches the lead's own holding.
  useRealtimeRouterRefresh({ tables: ['work_leads'] });
  // One job's Arbeitsnachweise at a time: each list keeps its own live view.
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  return (
    <section
      aria-labelledby="led-jobs-title"
      className="space-y-4 rounded-lg border bg-card p-4 sm:p-5"
      data-testid="led-jobs-section"
    >
      <SectionTitle id="led-jobs-title" icon={<UserRoundCheck className="size-4" />}>
        Deine Projektleitung
      </SectionTitle>
      {overview === 'failed' ? (
        <RegionLoadError title="Aufträge nicht geladen">
          Die Aufträge deiner Projektleitung konnten gerade nicht geladen werden.
        </RegionLoadError>
      ) : overview.jobs.length === 0 ? (
        <EmptyState
          size="compact"
          title="Noch keine Aufträge, die du leitest."
          description="Sobald das Büro welche im Projekt anlegt, erscheinen sie hier."
        />
      ) : (
        <ul className="space-y-3">
          {overview.jobs.map((job) => (
            <LedJobItem
              key={job.id}
              job={job}
              open={openJobId === job.id}
              onToggle={() => setOpenJobId((current) => (current === job.id ? null : job.id))}
              currentUserId={currentUserId}
              canApprove={canApprove}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function LedJobItem({
  job,
  open,
  onToggle,
  ...viewer
}: LeadViewer & { job: LedJob; open: boolean; onToggle: () => void }) {
  const toReview = job.artifacts.filter(
    (artifact) => artifact.kind === 'change_work' && artifact.status === 'submitted',
  ).length;
  return (
    <li className="space-y-3 rounded-md border p-3" data-testid="led-job">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium break-words">{job.title}</p>
          <p className="text-xs text-muted-foreground">
            {[job.jobNumber, job.plannedDate ? `geplant ${formatGermanDate(job.plannedDate)}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {job.executionState && (
            <Badge variant="secondary" className={WORK_EXECUTION_CLASSES[job.executionState]}>
              {WORK_EXECUTION_LABELS[job.executionState]}
            </Badge>
          )}
          {toReview > 0 && <Badge variant="outline">{toReview} zur Prüfung</Badge>}
        </div>
      </div>
      {job.requestedOutcome && <p className="text-sm whitespace-pre-line">{job.requestedOutcome}</p>}
      {job.instructions.length > 0 && (
        <ul className="space-y-1 text-sm" aria-label={`Anweisungen zu ${job.title}`}>
          {job.instructions.map((instruction) => (
            <li key={instruction.id} className="flex items-start gap-2">
              {instruction.completed ? (
                <CheckCircle2
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-label="Erledigt"
                />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Offen" />
              )}
              <span className={instruction.completed ? 'text-muted-foreground' : undefined}>
                {instruction.content}
                {instruction.required ? '' : ' (optional)'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="outline" size="sm" onClick={onToggle} aria-expanded={open}>
        {open ? 'Nachweise ausblenden' : `Nachweise ansehen (${job.artifacts.length})`}
      </Button>
      {open && (
        <WorkArtifactsSection
          refreshOnLeadSignal
          targetType="job"
          targetId={job.id}
          initialArtifacts={job.artifacts}
          isManager={false}
          canApprove={viewer.canApprove}
          currentUserId={viewer.currentUserId}
          documents={[]}
          readOnly
        />
      )}
    </li>
  );
}
