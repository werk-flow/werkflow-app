'use client';

import { useClientRead } from '@/hooks/use-client-read';
import { usePendingTask } from '@/hooks/use-server-action';
import { useState, useEffect, useRef } from 'react';
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
  const { run: runSubmit, isPending: isLoading } = usePendingTask();
  const [qualificationWarning, setQualificationWarning] = useState<AssignmentEvaluation | null>(null);
  const [confirmedDateRemovalForWarning, setConfirmedDateRemovalForWarning] = useState(false);
  const [assignmentTeamSourceId, setAssignmentTeamSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [showAutoParkDialog, setShowAutoParkDialog] = useState(false);
  const initializedJobIdRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);

  // The current crew and the visits are read each time the dialog opens; the crew is adopted during render.
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

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current && initializedJobIdRef.current === job.id) return;
    wasOpenRef.current = true;
    initializedJobIdRef.current = job.id;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- the draft is refilled from the job each time the dialog opens
    setJobNumber(job.jobNumber ?? '');
    setTitle(job.title);
    setDescription(job.description ?? '');
    setProjectId(job.projectId ?? '');
    setClientId(job.clientId ?? '');
    setPriority(job.priority);
    setPlannedDate(job.plannedDate ? new Date(job.plannedDate + 'T00:00:00') : undefined);
    setPlannedTime(job.plannedTime ?? '');
    setEstimatedHours(formatMinutesAsHoursInput(job.estimatedDurationMinutes));
    setPlannedWorkingHours(formatMinutesAsHoursInput(job.plannedWorkingMinutes));
    setPlannedWorkingTouched(false);
    setAutoSyncPlannedWorking(false);
    setLocation(job.location ?? '');
    setSiteId(job.siteId ?? '');
    setContactId(job.contactId ?? '');
    setError(null);
    setContentError(null);
    setHasAttemptedSubmit(false);
    setAssignmentTeamSourceId(null);
    setConfirmedDateRemovalForWarning(false);
    setQualificationWarning(null);
  }, [open, job]);

  const showContentError = hasAttemptedSubmit && contentError;
  const formDisabled = isLoading;
  // Submitting before the current assignments finished loading (or after the
  // load failed) would save an empty assignment list and wipe the job's crew.
  const submitDisabled = formDisabled || assignments.loading || assignments.failure !== null;

  const clientProjectLink = useEditJobClientProjectLink({
    knownProject,
    clientId,
    projectId,
    setClientId,
    setProjectId,
    setSiteId,
    setContactId,
  });

  const handleEstimatedHoursChange = (nextValue: string) => {
    setEstimatedHours(nextValue);
    setAutoSyncPlannedWorking(true);

    if (!plannedWorkingTouched) {
      const nextSuggestedMinutes = calculatePlannedWorkingMinutes(
        parseHoursInputToMinutes(nextValue),
        selectedEmployees.length,
      );
      setPlannedWorkingHours(formatMinutesAsHoursInput(nextSuggestedMinutes));
    }
  };

  const handleSelectedEmployeesChange = (nextSelectedEmployees: string[]) => {
    setSelectedEmployees(nextSelectedEmployees);
    setAutoSyncPlannedWorking(true);

    if (!plannedWorkingTouched) {
      const nextSuggestedMinutes = calculatePlannedWorkingMinutes(
        parseHoursInputToMinutes(estimatedHours),
        nextSelectedEmployees.length,
      );
      setPlannedWorkingHours(formatMinutesAsHoursInput(nextSuggestedMinutes));
    }
  };

  return {
    ...clientProjectLink,
    jobNumber,
    setJobNumber,
    title,
    setTitle,
    description,
    setDescription,
    clientId,
    projectId,
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
    handleEstimatedHoursChange,
    plannedWorkingHours,
    setPlannedWorkingHours,
    plannedWorkingTouched,
    setPlannedWorkingTouched,
    autoSyncPlannedWorking,
    location,
    setLocation,
    selectedEmployees,
    handleSelectedEmployeesChange,
    assignmentTeamSourceId,
    setAssignmentTeamSourceId,
    isLoadingAssignments: assignments.loading,
    // Null while the read runs or after it failed; the submit waits for it either way.
    visitPlan: assignments.data?.visits ?? null,
    assignmentsFailure: assignments.failure,
    isLoading,
    runSubmit,
    error,
    setError,
    contentError,
    setContentError,
    showContentError,
    setHasAttemptedSubmit,
    qualificationWarning,
    setQualificationWarning,
    confirmedDateRemovalForWarning,
    setConfirmedDateRemovalForWarning,
    showAutoParkDialog,
    setShowAutoParkDialog,
    formDisabled,
    submitDisabled,
  };
}

export type EditJobForm = ReturnType<typeof useEditJobForm>;
