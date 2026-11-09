'use client';

import { useEffect, useImperativeHandle, type Ref } from 'react';

import { buildTimelineFacts, type TimelineFact } from '@/lib/time-corrections/timeline';
import { CorrectionTimelineFields } from './time-correction-dialog-timeline';
import { useCorrectionTimeline } from './time-correction-dialog-timeline-state';

// The caller's own timeline of an earlier day as one section that loads on
// demand (manual-entry-form-content.tsx): it holds the rows, and the form
// asks it through the handle what a save sends.

/** What a save of the timeline sends: its facts for the subject, or the error of each invalid control in order. */
export type CorrectionTimelineCheck =
  | { valid: true; facts: (employeeRecordId: string) => TimelineFact[] }
  | { valid: false; fieldErrors: Record<string, string | undefined> };

export type CorrectionTimelineHandle = { check: () => CorrectionTimelineCheck };

export function CorrectionTimelineSection({
  handleRef,
  organizationId,
  dateIso,
  enabled,
  initialTimes,
  showErrors,
  onSpanChange,
}: {
  handleRef: Ref<CorrectionTimelineHandle>;
  organizationId: string;
  dateIso: string | null;
  enabled: boolean;
  initialTimes: { start: string; end: string } | undefined;
  showErrors: boolean;
  /** The first start and the last end, which the calendar draws as the draft. */
  onSpanChange: (start: string, end: string) => void;
}) {
  const timeline = useCorrectionTimeline({
    organizationId,
    employeeRecordId: undefined,
    dateIso,
    enabled,
    initialTimes,
  });
  useImperativeHandle(handleRef, () => ({
    check: () => {
      const { resolved, fieldErrors } = timeline.validate();
      return resolved.valid
        ? {
            valid: true,
            facts: (employeeRecordId) => buildTimelineFacts(resolved.segments, employeeRecordId),
          }
        : { valid: false, fieldErrors };
    },
  }));
  const start = timeline.rows[0]?.start ?? '';
  const end = timeline.rows.at(-1)?.end ?? '';
  useEffect(() => onSpanChange(start, end), [end, onSpanChange, start]);
  return <CorrectionTimelineFields timeline={timeline} showErrors={showErrors} />;
}
