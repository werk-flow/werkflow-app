import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';

import { DetailPageHeader } from '@/components/shared/detail-page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Badge } from '@/components/ui/badge';
import { UrlFlashBanner } from '@/components/ui/banner';
import { FormDisclosure } from '@/components/ui/form-disclosure';
import { FieldWorkPackExecutionSection } from '@/components/auftraege/work-pack/field-work-pack-execution-section';
import { FieldWorkPackOverview } from '@/components/auftraege/work-pack/field-work-pack-overview';
import { dispatchErrorMessage } from '@/lib/dispatch/types';
import { getJobByNumber } from '@/lib/jobs/actions';
import { WORK_EXECUTION_LABELS } from '@/lib/work-lifecycle/types';
import { WORK_EXECUTION_CLASSES } from '../status-classes';
import { FieldWorkPackContextSources, FieldWorkPackEquipmentSource } from './field-work-pack-context-sources';
import { loadFieldWorkPackData } from './field-work-pack-data';
import { jobDetailHref } from '@/lib/jobs/routes';
import { FieldWorkPackRecordSources, FieldWorkPackTimeAndMaterials } from './field-work-pack-record-sources';

export async function FieldWorkPackPage({
  jobNumber,
  expectedProjectNumber,
  currentUserId,
}: {
  jobNumber: string;
  expectedProjectNumber?: string;
  currentUserId: string;
}): Promise<ReactElement> {
  const jobResult = await getJobByNumber(decodeURIComponent(jobNumber));
  if (!jobResult.success) redirect('/auftraege');

  const job = jobResult.job;
  const currentUserAssignment = job.assignments.find((assignment) => assignment.userId === currentUserId);
  if (!currentUserAssignment) redirect('/auftraege');

  if (expectedProjectNumber) {
    if (job.project?.projectNumber !== decodeURIComponent(expectedProjectNumber)) {
      redirect('/auftraege');
    }
  } else if (job.project?.projectNumber) {
    redirect(jobDetailHref(job, job.project));
  }

  const data = await loadFieldWorkPackData(job, currentUserId, currentUserAssignment);
  const { fieldJob, lifecycleResult, dispatchResult, dispatchCards, readOnly } = data;

  return (
    <PageShell className="bg-muted/20">
      <UrlFlashBanner paramKey="field_transition" messageTemplate="Arbeitsstand wurde aktualisiert." />
      <DetailPageHeader
        breadcrumbs={[
          { label: 'Aufträge', href: '/auftraege' },
          ...(fieldJob.project ? [{ label: fieldJob.project.name }] : []),
          { label: `Auftrag ${fieldJob.jobNumber ?? 'Ohne Nummer'}` },
        ]}
        title={fieldJob.title}
        subtitle={`Auftrag ${fieldJob.jobNumber ?? 'Ohne Nummer'}`}
        badges={
          <Badge
            variant="secondary"
            className={
              lifecycleResult.success
                ? WORK_EXECUTION_CLASSES[lifecycleResult.snapshot.executionState]
                : undefined
            }
          >
            {lifecycleResult.success
              ? WORK_EXECUTION_LABELS[lifecycleResult.snapshot.executionState]
              : 'Arbeitsstand unbekannt'}
          </Badge>
        }
      />

      <PageBody maxWidth="wide">
        {/* The test id scopes the pack's body content; the specs never reach the header through it. */}
        <div data-testid="field-work-pack" className="space-y-4 sm:space-y-6">
          <FieldWorkPackOverview job={fieldJob} />
          <FieldWorkPackContextSources job={job} data={data} />
          <FieldWorkPackExecutionSection
            key={job.id}
            jobId={job.id}
            jobTitle={job.title}
            initialDispatchCards={dispatchCards}
            initialDispatchError={dispatchResult.success ? null : dispatchErrorMessage(dispatchResult.error)}
            lifecycleSnapshot={lifecycleResult.success ? lifecycleResult.snapshot : null}
            readOnly={readOnly}
          />

          <FieldWorkPackRecordSources job={job} currentUserId={currentUserId} data={data} />

          <FieldWorkPackEquipmentSource job={job} data={data} />

          <FieldWorkPackTimeAndMaterials job={job} currentUserId={currentUserId} data={data} />

          <section
            className="rounded-lg border bg-card p-4 shadow-xs sm:p-5"
            aria-labelledby="field-reference-heading"
          >
            <FormDisclosure label="Weitere Auftragsangaben">
              <div className="space-y-2 pt-3 text-sm">
                <h2 id="field-reference-heading" className="sr-only">
                  Weitere Auftragsangaben
                </h2>
                {fieldJob.project ? (
                  <p>
                    <span className="text-muted-foreground">Projekt:</span> {fieldJob.project.name} ·{' '}
                    {fieldJob.project.projectNumber}
                  </p>
                ) : (
                  <p className="text-muted-foreground">Dieser Auftrag gehört zu keinem Projekt.</p>
                )}
                <p className="text-muted-foreground">
                  Planung, Zeiterfassung, Material, Dokumente und Nachweise bleiben getrennte verbindliche
                  Bereiche.
                </p>
              </div>
            </FormDisclosure>
          </section>
        </div>
      </PageBody>
    </PageShell>
  );
}
