'use client';

import { useCallback, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { TextLink } from '@/components/ui/text-link';
import type { MetadataField } from '@/components/shared/metadata-section';
import { updateJob } from '@/lib/jobs/actions';
import { formatSiteAddress } from '@/lib/clients/types';
import {
  calculatePlannedWorkingMinutes,
  formatMinutesAsHoursInput,
  parseHoursInputToMinutes,
} from '@/lib/jobs/planned-working';
import {
  type JobWithDetails,
  type JobPriority,
  JOB_PRIORITY_LABELS,
  normalizeJobPlannedTime,
} from '@/lib/jobs/types';
import { jobFormEditsSchedule } from '@/lib/jobs/visit-schedule';
import { useQualificationWarningConfirmation } from '../shared/qualification-warning-dialog';
import { getJobStatusClass, getJobStatusLabel } from '../status-classes';
import { PRIORITY_CLASSES, formatDurationOrDash, formatPlannedTime } from './job-detail-format';
import { formatGermanDate, formatBerlinDateTime } from '@/lib/utils';

type JobDetailFieldContext = {
  liveJob: JobWithDetails;
  displayTitle: string;
  isAdminOrManager: boolean;
  /** False on a job with several visits: its schedule is planned on the Plantafel. */
  scheduleEditable: boolean;
  applyLiveJobPatch: (updatedJob: Partial<JobWithDetails>) => void;
  updateJobWithQualificationApproval: (
    input: Parameters<typeof updateJob>[1],
  ) => ReturnType<typeof updateJob>;
};

function buildJobDetailIdentityFields({
  liveJob,
  isAdminOrManager,
  applyLiveJobPatch,
}: JobDetailFieldContext): MetadataField[] {
  return [
    {
      label: 'Auftragsnummer',
      value: <span className="font-mono text-xs">{liveJob.jobNumber}</span>,
    },
    {
      label: 'Titel',
      value: liveJob.title,
      editableConfig: isAdminOrManager
        ? {
            type: 'text',
            currentValue: liveJob.title,
            onSave: async (v) => {
              const result = await updateJob(liveJob.id, { title: v });
              if (!result.success) {
                throw new Error('Failed to update title');
              }
              applyLiveJobPatch(result.job);
            },
          }
        : undefined,
    },
    {
      label: 'Beschreibung',
      value: liveJob.description || <span className="text-muted-foreground">Keine Beschreibung</span>,
      editableConfig: isAdminOrManager
        ? {
            type: 'textarea',
            currentValue: liveJob.description ?? '',
            onSave: async (v) => {
              const result = await updateJob(liveJob.id, { description: v });
              if (!result.success) {
                throw new Error('Failed to update description');
              }
              applyLiveJobPatch(result.job);
            },
            placeholder: 'Beschreibung hinzufügen…',
            nullable: true,
          }
        : undefined,
    },
    {
      label: 'Status',
      value: (
        <Badge variant="secondary" className={getJobStatusClass(liveJob)}>
          {getJobStatusLabel(liveJob)}
        </Badge>
      ),
    },
    {
      label: 'Priorität',
      value: (
        <Badge variant="secondary" className={PRIORITY_CLASSES[liveJob.priority]}>
          {JOB_PRIORITY_LABELS[liveJob.priority]}
        </Badge>
      ),
      editableConfig: isAdminOrManager
        ? {
            type: 'select',
            currentValue: liveJob.priority,
            onSave: async (v) => {
              const result = await updateJob(liveJob.id, {
                priority: v as JobPriority,
              });
              if (!result.success) {
                throw new Error('Failed to update priority');
              }
              applyLiveJobPatch(result.job);
            },
            options: Object.entries(JOB_PRIORITY_LABELS).map(([value, label]) => ({ value, label })),
          }
        : undefined,
    },
  ];
}

/** What removing a job's planned date keeps, in the confirmation before the save. */
function RemoveDateDescription({
  jobNumber,
  displayTitle,
}: {
  jobNumber: string | null;
  displayTitle: string;
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <p>
        Wenn du das geplante Datum von{' '}
        <span className="font-medium text-foreground">
          {jobNumber ? `${jobNumber} – ` : ''}
          {displayTitle}
        </span>{' '}
        entfernst, bleibt der Arbeitsstand unverändert.
      </p>
      <p className="font-medium text-muted-foreground">
        Parkplatz, Uhrzeit, Dauer und zugewiesene Mitarbeiter bleiben ebenfalls unverändert.
      </p>
    </div>
  );
}

/** The date of a job with several visits: they are planned on the Plantafel, not in the job's fields. */
function SeveralVisitsDate({ plannedDate }: { plannedDate: string | null }): React.JSX.Element {
  return (
    <span>
      Mehrere Termine ·{' '}
      <TextLink href={plannedDate ? `/kalender?date=${plannedDate}` : '/kalender'}>
        In der Plantafel planen
      </TextLink>
    </span>
  );
}

function buildJobDetailPlanningFields({
  liveJob,
  displayTitle,
  isAdminOrManager,
  scheduleEditable,
  applyLiveJobPatch,
  updateJobWithQualificationApproval,
}: JobDetailFieldContext): MetadataField[] {
  const editsSchedule = isAdminOrManager && scheduleEditable;
  return [
    {
      label: 'Geplantes Datum',
      value: scheduleEditable ? (
        formatGermanDate(liveJob.plannedDate, { empty: '—' })
      ) : (
        <SeveralVisitsDate plannedDate={liveJob.plannedDate} />
      ),
      editableConfig: editsSchedule
        ? {
            type: 'date',
            currentValue: liveJob.plannedDate ?? '',
            confirmBeforeSave: {
              shouldConfirm: (newValue, currentValue) =>
                currentValue.trim().length > 0 && newValue.trim().length === 0,
              title: 'Datum entfernen?',
              description: (
                <RemoveDateDescription jobNumber={liveJob.jobNumber} displayTitle={displayTitle} />
              ),
              confirmLabel: 'Datum entfernen',
              loadingLabel: 'Wird gespeichert…',
            },
            onSave: async (v) => {
              const result = await updateJobWithQualificationApproval({
                plannedDate: v || null,
              });
              if (!result.success) {
                throw new Error('Failed to update planned date');
              }
              applyLiveJobPatch(result.job);
            },
            nullable: true,
          }
        : undefined,
    },
    {
      label: 'Geplante Uhrzeit',
      value: formatPlannedTime(liveJob.plannedTime),
      editableConfig: editsSchedule
        ? {
            type: 'time',
            currentValue: normalizeJobPlannedTime(liveJob.plannedTime) ?? '',
            onSave: async (v) => {
              const result = await updateJob(liveJob.id, {
                plannedTime: v || null,
              });
              if (!result.success) {
                throw new Error('Failed to update planned time');
              }
              applyLiveJobPatch(result.job);
            },
            placeholder: 'z.B. 08:00',
            nullable: true,
          }
        : undefined,
    },
    {
      label: 'Geschätzte Dauer',
      value: formatDurationOrDash(liveJob.estimatedDurationMinutes),
      editableConfig: editsSchedule
        ? {
            type: 'duration',
            currentValue: formatMinutesAsHoursInput(liveJob.estimatedDurationMinutes),
            onSave: async (v) => {
              const estimatedDurationMinutes = v.trim() ? parseHoursInputToMinutes(v) : null;
              const plannedWorkingMinutes = calculatePlannedWorkingMinutes(
                estimatedDurationMinutes,
                liveJob.assignments.length,
              );
              const result = await updateJob(liveJob.id, {
                estimatedDurationMinutes,
                plannedWorkingMinutes,
              });
              if (!result.success) {
                throw new Error('Failed to update estimated duration');
              }
              applyLiveJobPatch(result.job);
            },
            placeholder: 'z.B. 2.5',
            nullable: true,
          }
        : undefined,
    },
    {
      label: 'Geplanter Arbeitsaufwand',
      value: formatDurationOrDash(liveJob.plannedWorkingMinutes),
      editableConfig: isAdminOrManager
        ? {
            type: 'duration',
            currentValue: formatMinutesAsHoursInput(liveJob.plannedWorkingMinutes),
            onSave: async (v) => {
              const result = await updateJob(liveJob.id, {
                plannedWorkingMinutes: v.trim() ? parseHoursInputToMinutes(v) : null,
              });
              if (!result.success) {
                throw new Error('Failed to update planned effort');
              }
              applyLiveJobPatch(result.job);
            },
            placeholder: 'z.B. 5',
            nullable: true,
          }
        : undefined,
    },
    {
      label: 'Ort',
      value: liveJob.location || '—',
      editableConfig: isAdminOrManager
        ? {
            type: 'text',
            currentValue: liveJob.location ?? '',
            onSave: async (v) => {
              const result = await updateJob(liveJob.id, { location: v });
              if (!result.success) {
                throw new Error('Failed to update location');
              }
              applyLiveJobPatch(result.job);
            },
            placeholder: 'Adresse oder Ort',
            nullable: true,
          }
        : undefined,
    },
  ];
}

// Site and contact come from the server-loaded job: an inline save returns the job row without them.
function buildJobDetailSiteFields(job: JobWithDetails, liveJob: JobWithDetails): MetadataField[] {
  return [
    ...(job.site
      ? [
          {
            label: 'Einsatzort',
            value: (
              <span className="flex flex-col gap-0.5">
                <span>{job.site.name}</span>
                {formatSiteAddress(job.site) && (
                  <span className="text-xs text-muted-foreground">{formatSiteAddress(job.site)}</span>
                )}
                {job.site.accessNotes && (
                  <span className="text-xs text-muted-foreground">Zugang: {job.site.accessNotes}</span>
                )}
              </span>
            ),
          },
        ]
      : []),
    ...(job.contact
      ? [
          {
            label: 'Ansprechpartner',
            value: (
              <span className="flex flex-col gap-0.5">
                <span>
                  {job.contact.name}
                  {job.contact.role ? ` (${job.contact.role})` : ''}
                </span>
                {job.contact.phone && (
                  <a
                    href={`tel:${job.contact.phone.replace(/(?!^\+)[^\d]/g, '')}`}
                    className="text-xs text-primary-text hover:underline"
                  >
                    {job.contact.phone}
                  </a>
                )}
              </span>
            ),
          },
        ]
      : []),
    ...(liveJob.actualCompletionDate
      ? [
          {
            label: 'Abschlussdatum',
            value: formatGermanDate(liveJob.actualCompletionDate, { empty: '—' }),
          },
        ]
      : []),
    {
      label: 'Erstellt am',
      value: formatBerlinDateTime(liveJob.createdAt),
    },
  ];
}

type JobDetailMetadataFieldsInput = Omit<
  JobDetailFieldContext,
  'updateJobWithQualificationApproval' | 'scheduleEditable'
> & {
  job: JobWithDetails;
};

/** The inline-editable "Details" fields of a job and the qualification warning their saves can raise. */
export function useJobDetailMetadataFields({
  job,
  liveJob,
  displayTitle,
  isAdminOrManager,
  applyLiveJobPatch,
}: JobDetailMetadataFieldsInput): {
  metadataFields: MetadataField[];
  inlineEditWarningDialog: ReactNode;
} {
  const { requestApproval: requestInlineEditApproval, warningDialog: inlineEditWarningDialog } =
    useQualificationWarningConfirmation();

  const updateJobWithQualificationApproval = useCallback(
    async (input: Parameters<typeof updateJob>[1]) => {
      let result = await updateJob(liveJob.id, input);
      if (
        !result.success &&
        (result.error === 'qualification_warning' || result.error === 'stale_evaluation') &&
        'evaluation' in result
      ) {
        const approval = await requestInlineEditApproval(result.evaluation);
        if (approval) {
          result = await updateJob(liveJob.id, {
            ...input,
            assignmentApproval: approval,
          });
        }
      }
      return result;
    },
    [liveJob.id, requestInlineEditApproval],
  );

  const fieldContext: JobDetailFieldContext = {
    liveJob,
    displayTitle,
    isAdminOrManager,
    scheduleEditable: jobFormEditsSchedule(job.scheduledVisitCount ?? 0),
    applyLiveJobPatch,
    updateJobWithQualificationApproval,
  };
  const metadataFields: MetadataField[] = [
    ...buildJobDetailIdentityFields(fieldContext),
    ...buildJobDetailPlanningFields(fieldContext),
    ...buildJobDetailSiteFields(job, liveJob),
  ];

  return { metadataFields, inlineEditWarningDialog };
}
