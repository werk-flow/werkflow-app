'use client';

import { useClientRead } from '@/hooks/use-client-read';
import { usePendingTask } from '@/hooks/use-server-action';
import { useState, useEffect, useRef, type RefObject } from 'react';
import { readInBackground } from '@/lib/data/background-read-client';
import type { AssignmentEvaluation } from '@/lib/qualifications/types';
import type { Job, JobPriority } from '@/lib/jobs/types';
import type { JobEntityOption } from '@/lib/jobs/option-types';
import {
  calculatePlannedWorkingMinutes,
  formatMinutesAsHoursInput,
  parseHoursInputToMinutes,
} from '@/lib/jobs/planned-working';
import { useEditJobClientProjectLink } from './use-edit-job-client-project-link';

type EditJobFormInput = {
  job: Job;
  open: boolean;
  knownProject: JobEntityOption | undefined;
};

/** Draft state of the edit-job dialog: filled from the job each time the dialog opens. */
export function useEditJobForm({ job, open, knownProject }: EditJobFormInput) {
  const fields = useEditJobDraftFields();
  const { run: runSubmit, isPending: isLoading } = usePendingTask();
  const status = useEditJobDialogStatus();
  const initializedJobIdRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);
  const assignments = useEditJobAssignments({ job, open, setSelectedEmployees: fields.setSelectedEmployees });
  useRefillEditJobDraftOnOpen({ job, open, fields, status, initializedJobIdRef, wasOpenRef });

  const showContentError = status.hasAttemptedSubmit && status.contentError;
  const formDisabled = isLoading;
  // Submitting before the current assignments finished loading (or after the
  // load failed) would save an empty assignment list and wipe the job's crew.
  const submitDisabled = formDisabled || assignments.loading || assignments.failure !== null;

  const clientProjectLink = useEditJobClientProjectLink({
    knownProject,
    clientId: fields.clientId,
    projectId: fields.projectId,
    setClientId: fields.setClientId,
    setProjectId: fields.setProjectId,
    setSiteId: fields.setSiteId,
    setContactId: fields.setContactId,
  });
  const { handleEstimatedHoursChange, handleSelectedEmployeesChange } = editJobPlannedWorkingHandlers(fields);

  return {
    ...clientProjectLink,
    jobNumber: fields.jobNumber,
    setJobNumber: fields.setJobNumber,
    title: fields.title,
    setTitle: fields.setTitle,
    description: fields.description,
    setDescription: fields.setDescription,
    clientId: fields.clientId,
    projectId: fields.projectId,
    siteId: fields.siteId,
    setSiteId: fields.setSiteId,
    contactId: fields.contactId,
    setContactId: fields.setContactId,
    priority: fields.priority,
    setPriority: fields.setPriority,
    plannedDate: fields.plannedDate,
    setPlannedDate: fields.setPlannedDate,
    plannedTime: fields.plannedTime,
    setPlannedTime: fields.setPlannedTime,
    estimatedHours: fields.estimatedHours,
    handleEstimatedHoursChange,
    plannedWorkingHours: fields.plannedWorkingHours,
    setPlannedWorkingHours: fields.setPlannedWorkingHours,
    plannedWorkingTouched: fields.plannedWorkingTouched,
    setPlannedWorkingTouched: fields.setPlannedWorkingTouched,
    autoSyncPlannedWorking: fields.autoSyncPlannedWorking,
    location: fields.location,
    setLocation: fields.setLocation,
    selectedEmployees: fields.selectedEmployees,
    handleSelectedEmployeesChange,
    assignmentTeamSourceId: status.assignmentTeamSourceId,
    setAssignmentTeamSourceId: status.setAssignmentTeamSourceId,
    isLoadingAssignments: assignments.loading,
    // Null while the read runs or after it failed; the submit waits for it either way.
    visitPlan: assignments.data?.visits ?? null,
    assignmentsFailure: assignments.failure,
    isLoading,
    runSubmit,
    error: status.error,
    setError: status.setError,
    contentError: status.contentError,
    setContentError: status.setContentError,
    showContentError,
    setHasAttemptedSubmit: status.setHasAttemptedSubmit,
    qualificationWarning: status.qualificationWarning,
    setQualificationWarning: status.setQualificationWarning,
    confirmedDateRemovalForWarning: status.confirmedDateRemovalForWarning,
    setConfirmedDateRemovalForWarning: status.setConfirmedDateRemovalForWarning,
    showAutoParkDialog: status.showAutoParkDialog,
    setShowAutoParkDialog: status.setShowAutoParkDialog,
    formDisabled,
    submitDisabled,
  };
}

/** The job's own fields as the dialog edits them. */
function useEditJobDraftFields() {
  const [jobNumber, setJobNumber] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [siteId, setSiteId] = useState<string>('');
  const [contactId, setContactId] = useState<string>('');
  const [priority, setPriority] = useState<JobPriority>('mittel');
  const [plannedDate, setPlannedDate] = useState<Date | undefined>();
  const [plannedTime, setPlannedTime] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [plannedWorkingHours, setPlannedWorkingHours] = useState('');
  const [plannedWorkingTouched, setPlannedWorkingTouched] = useState(false);
  const [autoSyncPlannedWorking, setAutoSyncPlannedWorking] = useState(false);
  const [location, setLocation] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);

  return {
    jobNumber,
    setJobNumber,
    title,
    setTitle,
    description,
    setDescription,
    clientId,
    setClientId,
    projectId,
    setProjectId,
    siteId,
    setSiteId,
    contactId,
    setContactId,
    priority,
    setPriority,
    plannedDate,
    setPlannedDate,
    plannedTime,
    setPlannedTime,
    estimatedHours,
    setEstimatedHours,
    plannedWorkingHours,
    setPlannedWorkingHours,
    plannedWorkingTouched,
    setPlannedWorkingTouched,
    autoSyncPlannedWorking,
    setAutoSyncPlannedWorking,
    location,
    setLocation,
    selectedEmployees,
    setSelectedEmployees,
  };
}

type EditJobDraftFields = ReturnType<typeof useEditJobDraftFields>;

/** The dialog's own state around the draft: warnings, failures and the auto-park question. */
function useEditJobDialogStatus() {
  const [qualificationWarning, setQualificationWarning] = useState<AssignmentEvaluation | null>(null);
  const [confirmedDateRemovalForWarning, setConfirmedDateRemovalForWarning] = useState(false);
  const [assignmentTeamSourceId, setAssignmentTeamSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [showAutoParkDialog, setShowAutoParkDialog] = useState(false);

  return {
    qualificationWarning,
    setQualificationWarning,
    confirmedDateRemovalForWarning,
    setConfirmedDateRemovalForWarning,
    assignmentTeamSourceId,
    setAssignmentTeamSourceId,
    error,
    setError,
    contentError,
    setContentError,
    hasAttemptedSubmit,
    setHasAttemptedSubmit,
    showAutoParkDialog,
    setShowAutoParkDialog,
  };
}

type EditJobDialogStatus = ReturnType<typeof useEditJobDialogStatus>;

type EditJobAssignmentsInput = {
  job: Job;
  open: boolean;
  setSelectedEmployees: EditJobDraftFields['setSelectedEmployees'];
};

/** The current crew and the visits, read each time the dialog opens; the crew is adopted during render. */
function useEditJobAssignments({ job, open, setSelectedEmployees }: EditJobAssignmentsInput) {
  const assignments = useClientRead({
    read: (signal) => readInBackground('job-details', { jobId: job.id }, signal),
    deps: [job.id],
    enabled: open,
    failureMessage: 'Die aktuellen Zuweisungen konnten nicht geladen werden.',
  });
  const [adoptedAssignments, setAdoptedAssignments] = useState(assignments.data);
  if (assignments.data !== adoptedAssignments) {
    setAdoptedAssignments(assignments.data);
    if (assignments.data) setSelectedEmployees(assignments.data.job.assignments.map((a) => a.userId));
  }
  return assignments;
}

type EditJobDraftRefillInput = {
  job: Job;
  open: boolean;
  fields: EditJobDraftFields;
  status: EditJobDialogStatus;
  initializedJobIdRef: RefObject<string | null>;
  wasOpenRef: RefObject<boolean>;
};

/** Refills the draft from the job each time the dialog opens, or when it opens on another job. */
function useRefillEditJobDraftOnOpen({
  job,
  open,
  fields,
  status,
  initializedJobIdRef,
  wasOpenRef,
}: EditJobDraftRefillInput) {
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current && initializedJobIdRef.current === job.id) return;
    wasOpenRef.current = true;
    initializedJobIdRef.current = job.id;

    fields.setJobNumber(job.jobNumber ?? '');
    fields.setTitle(job.title);
    fields.setDescription(job.description ?? '');
    fields.setProjectId(job.projectId ?? '');
    fields.setClientId(job.clientId ?? '');
    fields.setPriority(job.priority);
    fields.setPlannedDate(job.plannedDate ? new Date(job.plannedDate + 'T00:00:00') : undefined);
    fields.setPlannedTime(job.plannedTime ?? '');
    fields.setEstimatedHours(formatMinutesAsHoursInput(job.estimatedDurationMinutes));
    fields.setPlannedWorkingHours(formatMinutesAsHoursInput(job.plannedWorkingMinutes));
    fields.setPlannedWorkingTouched(false);
    fields.setAutoSyncPlannedWorking(false);
    fields.setLocation(job.location ?? '');
    fields.setSiteId(job.siteId ?? '');
    fields.setContactId(job.contactId ?? '');
    status.setError(null);
    status.setContentError(null);
    status.setHasAttemptedSubmit(false);
    status.setAssignmentTeamSourceId(null);
    status.setConfirmedDateRemovalForWarning(false);
    status.setQualificationWarning(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fields and status hold useState setters and the refs are stable; the draft refills only when the dialog opens or the job changes
  }, [open, job]);
}

/** A planned working effort suggestion: the estimated duration times the crew size. */
function suggestedPlannedWorkingHours(estimatedHoursInput: string, employeeCount: number): string {
  return formatMinutesAsHoursInput(
    calculatePlannedWorkingMinutes(parseHoursInputToMinutes(estimatedHoursInput), employeeCount),
  );
}

/** A duration or crew change recomputes the planned working effort until the user sets it by hand. */
function editJobPlannedWorkingHandlers(fields: EditJobDraftFields) {
  const handleEstimatedHoursChange = (nextValue: string) => {
    fields.setEstimatedHours(nextValue);
    fields.setAutoSyncPlannedWorking(true);

    if (!fields.plannedWorkingTouched) {
      fields.setPlannedWorkingHours(suggestedPlannedWorkingHours(nextValue, fields.selectedEmployees.length));
    }
  };

  const handleSelectedEmployeesChange = (nextSelectedEmployees: string[]) => {
    fields.setSelectedEmployees(nextSelectedEmployees);
    fields.setAutoSyncPlannedWorking(true);

    if (!fields.plannedWorkingTouched) {
      fields.setPlannedWorkingHours(
        suggestedPlannedWorkingHours(fields.estimatedHours, nextSelectedEmployees.length),
      );
    }
  };

  return { handleEstimatedHoursChange, handleSelectedEmployeesChange };
}

export type EditJobForm = ReturnType<typeof useEditJobForm>;
