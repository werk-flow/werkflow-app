import { createActivitySelection } from './segments';
import { TIME_ACTIVITY_LABELS } from './types';
import type {
  ClockJobInfo,
  LiveClockState,
  TimeActivitySelection,
  TimeTransitionError,
} from './types';

/**
 * The next valid clock actions for a state, in the order a field worker most
 * likely needs them. One derivation feeds the clock button's sheet, its hot
 * keys and the Zeiterfassung dashboard, so every surface offers the same
 * transitions with the same labels (pre-Wave-3 step 3).
 */
export type ClockActionIcon = 'work' | 'travel' | 'break' | 'resume' | 'job' | 'end' | 'more';
export type ClockPickerMode = 'clock_in' | 'switch' | 'resume';

export type ClockAction = { id: string; label: string; icon: ClockActionIcon } & (
  | { kind: 'transition'; selection: TimeActivitySelection }
  | { kind: 'picker'; pickerMode: ClockPickerMode }
  | { kind: 'end' }
  | { kind: 'more' }
);

const MORE_ACTION: ClockAction = {
  id: 'more',
  kind: 'more',
  label: 'Weitere Aktivitäten …',
  icon: 'more',
};
const END_ACTION: ClockAction = {
  id: 'end',
  kind: 'end',
  label: 'Erfassung beenden',
  icon: 'end',
};

function jobLabel(job: ClockJobInfo | null): string {
  return job ? job.title : 'Auftrag';
}

/** "Arbeit · Heizungswartung Müller" for pills, headers and resume buttons. */
export function describeActivity(
  selection: TimeActivitySelection,
  job: ClockJobInfo | null
): string {
  const kindLabel = TIME_ACTIVITY_LABELS[selection.kind];
  return selection.allocationKind === 'job' ? `${kindLabel} · ${jobLabel(job)}` : kindLabel;
}

function breakAction(state: LiveClockState): ClockAction[] {
  return state.breakMode === 'manual'
    ? [{ id: 'break', kind: 'transition', label: 'Pause', icon: 'break', selection: createActivitySelection('break') }]
    : [];
}

export function deriveClockActions(state: LiveClockState | null): ClockAction[] {
  if (!state || !state.isClockedIn) {
    return [
      { id: 'start-work', kind: 'transition', label: 'Arbeit starten', icon: 'work', selection: createActivitySelection('work') },
      { id: 'start-work-job', kind: 'picker', label: 'Arbeit an Auftrag …', icon: 'job', pickerMode: 'clock_in' },
      { id: 'start-travel', kind: 'transition', label: 'Fahrt starten', icon: 'travel', selection: createActivitySelection('travel') },
      MORE_ACTION,
    ];
  }
  const current = state.currentActivity;
  const activeJobId = state.activeJobId;
  if (current?.kind === 'break') {
    const resume = state.resumeActivity ?? createActivitySelection('work');
    const actions: ClockAction[] = [
      { id: 'resume', kind: 'transition', label: `Weiter: ${describeActivity(resume, state.resumeJobInfo)}`, icon: 'resume', selection: resume },
    ];
    if (resume.allocationKind === 'job') {
      actions.push({ id: 'resume-unallocated', kind: 'transition', label: 'Weiter ohne Auftrag', icon: 'work', selection: createActivitySelection('work') });
    }
    actions.push(
      { id: 'resume-other-job', kind: 'picker', label: 'Anderer Auftrag …', icon: 'job', pickerMode: 'resume' },
      END_ACTION,
      MORE_ACTION
    );
    return actions;
  }
  if (current?.kind === 'travel') {
    return [
      activeJobId
        ? { id: 'arrive', kind: 'transition', label: `Arbeit an ${jobLabel(state.activeJobInfo)}`, icon: 'work', selection: createActivitySelection('work', activeJobId) }
        : { id: 'arrive', kind: 'transition', label: 'Arbeit starten', icon: 'work', selection: createActivitySelection('work') },
      { id: 'arrive-other-job', kind: 'picker', label: activeJobId ? 'Arbeit an anderem Auftrag …' : 'Arbeit an Auftrag …', icon: 'job', pickerMode: 'switch' },
      ...breakAction(state),
      END_ACTION,
      MORE_ACTION,
    ];
  }
  if (current?.kind === 'work' || current?.kind === 'callout') {
    return [
      ...breakAction(state),
      { id: 'travel', kind: 'transition', label: 'Fahrt starten', icon: 'travel', selection: createActivitySelection('travel', activeJobId) },
      activeJobId
        ? { id: 'switch-job', kind: 'picker', label: 'Auftrag wechseln …', icon: 'job', pickerMode: 'switch' }
        : { id: 'assign-job', kind: 'picker', label: 'Auftrag zuordnen …', icon: 'job', pickerMode: 'switch' },
      END_ACTION,
      MORE_ACTION,
    ];
  }
  // Standby, internal activity, and the bridged legacy session: back to work first.
  return [
    { id: 'work', kind: 'transition', label: 'Arbeit starten', icon: 'work', selection: createActivitySelection('work') },
    { id: 'work-job', kind: 'picker', label: 'Arbeit an Auftrag …', icon: 'job', pickerMode: 'switch' },
    ...breakAction(state),
    END_ACTION,
    MORE_ACTION,
  ];
}

/** The two most likely next transitions, shown as hot keys above the button while clocked in. */
export function selectClockHotKeys(actions: readonly ClockAction[]): ClockAction[] {
  return actions
    .filter((action) => action.kind === 'transition' || action.kind === 'picker')
    .slice(0, 2);
}

/**
 * Which activity a picked job continues: the running kind when it carries a
 * job (a travel switch stays a travel), otherwise work.
 */
export function selectionForPickedJob(
  state: LiveClockState | null,
  jobId: string | null
): TimeActivitySelection {
  const kind = state?.currentActivity?.kind;
  return createActivitySelection(kind === 'travel' || kind === 'callout' ? kind : 'work', jobId);
}

/**
 * True when two selections describe the same activity, job and qualifiers.
 * The database answers such a switch with `no_change` and no new segment;
 * the UI does not offer it in the first place.
 */
export function isSameActivitySelection(
  left: TimeActivitySelection | null | undefined,
  right: TimeActivitySelection | null | undefined
): boolean {
  if (!left || !right) return false;
  return (
    left.kind === right.kind &&
    left.allocationKind === right.allocationKind &&
    (left.jobId ?? null) === (right.jobId ?? null) &&
    (left.internalType ?? null) === (right.internalType ?? null) &&
    (left.travelRoute ?? null) === (right.travelRoute ?? null) &&
    (left.travelRole ?? null) === (right.travelRole ?? null) &&
    (left.standbyContext ?? null) === (right.standbyContext ?? null)
  );
}

const TRANSITION_ERROR_MESSAGES: Partial<Record<TimeTransitionError, string>> = {
  time_transition_stale_version:
    'Der Stand hat sich geändert. Bitte prüfe die aktuelle Erfassung und versuche es erneut.',
  time_transition_working_other_org:
    'Bereits in anderer Organisation eingestempelt: Bitte beende dort zuerst die laufende Zeiterfassung.',
  on_approved_vacation:
    'Heute ist Urlaub genehmigt: Einstempeln ist deshalb nicht möglich. Falls du doch arbeitest, kann eine verantwortliche Person den Urlaub stornieren.',
  time_transition_break_mode_automatic:
    'Pausen werden in dieser Organisation automatisch abgezogen.',
};

export function getTransitionErrorMessage(error: TimeTransitionError, fallback: string): string {
  return TRANSITION_ERROR_MESSAGES[error] ?? fallback;
}
