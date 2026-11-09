'use client';

import { Coffee, Plus, Trash2 } from 'lucide-react';

import { ACTIVITY_OPTIONS, TimeActivityQualifierFields } from '@/components/time-activity-fields';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TimeInput } from '@/components/ui/time-input';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { describeBreakShortfall } from '@/lib/time-corrections/break-warning';
import type { CorrectionTimelineRow, TimelineRowErrors } from '@/lib/time-corrections/timeline';
import type { TimeSegmentKind } from '@/lib/time-tracking/types';
import { timelineFieldId, type CorrectionTimelineState } from './time-correction-dialog-timeline-state';

// The timeline of a forgotten day: its activities in order, each with its
// times, job and the details live capture asks for, and the warning when the
// statutory break is missing (lib/time-corrections/break-warning.ts).

const JOB_KINDS: readonly TimeSegmentKind[] = ['work', 'callout', 'travel'];

function TimelineJobField({
  row,
  number,
  onChange,
}: {
  row: CorrectionTimelineRow;
  number: number;
  onChange: (jobId: string | null) => void;
}) {
  // Open jobs of the whole organization, as every correction offers them.
  const jobSearch = useJobEntityOptions(
    { kind: 'jobs', purpose: 'time-correction' },
    row.jobId ? [row.jobId] : [],
  );
  return (
    <Field label="Auftrag" className="gap-1.5">
      <SearchableSelect
        ariaLabel={`Auftrag der Tätigkeit ${number}`}
        options={[{ value: 'none', label: 'Ohne Auftrag' }, ...jobSearch.options]}
        value={row.jobId ?? 'none'}
        onChange={(value) => onChange(value === 'none' ? null : value)}
        onSearchChange={jobSearch.onSearchChange}
        loading={jobSearch.loading}
        loadFailure={jobSearch.loadFailure}
        onLoadMore={jobSearch.onLoadMore}
        searchPlaceholder="Auftrag suchen …"
        emptyMessage="Kein Auftrag gefunden"
      />
    </Field>
  );
}

function TimelineTimeFields({
  row,
  errors,
  onChange,
}: {
  row: CorrectionTimelineRow;
  errors: TimelineRowErrors;
  onChange: (patch: Partial<Pick<CorrectionTimelineRow, 'start' | 'end' | 'endsNextDay'>>) => void;
}) {
  // Only an end at or before the start can lie on the next day; the choice stays explicit.
  const offersNextDay = Boolean(row.start && row.end && row.end <= row.start);
  const nextDayId = `${timelineFieldId(row.key, 'end')}-next-day`;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Von" htmlFor={timelineFieldId(row.key, 'start')} required error={errors.start}>
          <TimeInput value={row.start} onChange={(start) => onChange({ start })} />
        </Field>
        <Field label="Bis" htmlFor={timelineFieldId(row.key, 'end')} required error={errors.end}>
          <TimeInput value={row.end} onChange={(end) => onChange({ end })} />
        </Field>
      </div>
      {offersNextDay ? (
        <label htmlFor={nextDayId} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
          <Checkbox
            id={nextDayId}
            checked={row.endsNextDay}
            onCheckedChange={(checked) => onChange({ endsNextDay: checked === true })}
          />
          Endet am nächsten Tag
        </label>
      ) : null}
    </div>
  );
}

function TimelineRowFields({
  row,
  number,
  errors,
  timeline,
}: {
  row: CorrectionTimelineRow;
  number: number;
  errors: TimelineRowErrors;
  timeline: CorrectionTimelineState;
}) {
  const update = (patch: Partial<Omit<CorrectionTimelineRow, 'key'>>) => timeline.updateRow(row.key, patch);
  return (
    <li className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Tätigkeit {number}</p>
        {timeline.rows.length > 1 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Tätigkeit ${number} entfernen`}
            onClick={() => timeline.removeRow(row.key)}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </div>
      <Field label="Art" htmlFor={timelineFieldId(row.key, 'kind')} error={errors.kind}>
        <Select
          value={row.kind}
          onValueChange={(value) => {
            const option = ACTIVITY_OPTIONS.find((candidate) => candidate.kind === value);
            if (option) update({ kind: option.kind });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTIVITY_OPTIONS.map((option) => (
              <SelectItem key={option.kind} value={option.kind}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <TimelineTimeFields row={row} errors={errors} onChange={update} />
      {JOB_KINDS.includes(row.kind) ? (
        <TimelineJobField row={row} number={number} onChange={(jobId) => update({ jobId })} />
      ) : null}
      <TimeActivityQualifierFields
        idPrefix={`correction-timeline-${row.key}-`}
        kind={row.kind}
        internalType={row.internalType}
        onInternalTypeChange={(internalType) => update({ internalType })}
        travelRoute={row.travelRoute}
        onTravelRouteChange={(travelRoute) => update({ travelRoute })}
        travelRole={row.travelRole}
        onTravelRoleChange={(travelRole) => update({ travelRole })}
        standbyContext={row.standbyContext}
        onStandbyContextChange={(standbyContext) => update({ standbyContext })}
      />
      {timeline.canInsertBreak(row.key) ? (
        <Button type="button" variant="outline" size="sm" onClick={() => timeline.insertBreak(row.key)}>
          <Coffee className="mr-1.5 size-4" />
          Pause einfügen
        </Button>
      ) : null}
    </li>
  );
}

export function CorrectionTimelineFields({
  timeline,
  showErrors,
}: {
  timeline: CorrectionTimelineState;
  /** „Speichern“ was pressed: each row shows its errors. */
  showErrors: boolean;
}) {
  return (
    <section
      className="space-y-3"
      aria-labelledby="correction-timeline-heading"
      aria-busy={timeline.loadingVisits}
    >
      <h3 id="correction-timeline-heading" className="text-sm font-medium">
        Ablauf des Tages
      </h3>
      {timeline.loadingVisits ? (
        <p role="status" className="text-sm text-muted-foreground">
          Geplante Einsätze werden geladen …
        </p>
      ) : null}
      {timeline.visitsNotice === 'failed' ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <p>Die geplanten Einsätze konnten nicht geladen werden.</p>
          <Button type="button" variant="outline" size="sm" onClick={timeline.retryVisits}>
            Erneut laden
          </Button>
        </div>
      ) : null}
      {timeline.visitsNotice === 'overflow' ? (
        <p className="text-sm text-muted-foreground">
          An dem Tag sind mehr Einsätze geplant, als ein Nachtrag fasst. Trag die Tätigkeiten selbst ein.
        </p>
      ) : null}
      <ol className="space-y-3">
        {timeline.rows.map((row, index) => (
          <TimelineRowFields
            key={row.key}
            row={row}
            number={index + 1}
            errors={(showErrors ? timeline.errors[index] : undefined) ?? {}}
            timeline={timeline}
          />
        ))}
      </ol>
      {timeline.canAddRow ? (
        <Button type="button" variant="outline" size="sm" onClick={timeline.addRow}>
          <Plus className="mr-1.5 size-4" />
          Tätigkeit hinzufügen
        </Button>
      ) : null}
      {timeline.shortfall ? (
        <p
          role="status"
          className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground"
        >
          {describeBreakShortfall(timeline.shortfall)}
        </p>
      ) : null}
    </section>
  );
}
