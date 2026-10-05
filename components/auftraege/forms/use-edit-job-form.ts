'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getJobDetails } from '@/lib/jobs/actions';
import type { AssignmentEvaluation } from '@/lib/qualifications/types';
import type { Client, Job, JobPriority, ProjectWithDetails } from '@/lib/jobs/types';
import {
  calculatePlannedWorkingMinutes,
  formatMinutesAsHoursInput,
  parseHoursInputToMinutes,
} from '@/lib/jobs/planned-working';
import { useEditJobClientProjectLink } from './use-edit-job-client-project-link';

type EditJobFormInput = {
  job: Job;
  open: boolean;
  clients: Client[];
  projects: ProjectWithDetails[];
};

/** Draft state of the edit-job dialog: filled from the job each time the dialog opens. */
export function useEditJobForm({ job, open, clients, projects }: EditJobFormInput) {
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
  const [isLoading, setIsLoading] = useState(false);
  const [qualificationWarning, setQualificationWarning] = useState<AssignmentEvaluation | null>(null);
  const [confirmedDateRemovalForWarning, setConfirmedDateRemovalForWarning] = useState(false);
  const [assignmentTeamSourceId, setAssignmentTeamSourceId] = useState<string | null>(null);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
  const [assignmentsLoadFailed, setAssignmentsLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [showAutoParkDialog, setShowAutoParkDialog] = useState(false);
  const initializedJobIdRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);

  const loadAssignments = useCallback((jobId: string) => {
    setIsLoadingAssignments(true);
    setAssignmentsLoadFailed(false);
    getJobDetails(jobId)
      .then((result) => {
        if (result.success) {
          const ids = result.job.assignments.map((a) => a.userId);
          setSelectedEmployees(ids);
        } else {
          setAssignmentsLoadFailed(true);
        }
        setIsLoadingAssignments(false);
      })
      .catch(() => {
        setAssignmentsLoadFailed(true);
        setIsLoadingAssignments(false);
      });
  }, []);

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

    loadAssignments(job.id);
  }, [open, job, loadAssignments]);

  const showContentError = hasAttemptedSubmit && contentError;
  const formDisabled = isLoading;
  // Submitting before the current assignments finished loading (or after the
  // load failed) would save an empty assignment list and wipe the job's crew.
  const submitDisabled = formDisabled || isLoadingAssignments || assignmentsLoadFailed;

  const clientProjectLink = useEditJobClientProjectLink({
    clients,
    projects,
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
    isLoadingAssignments,
    assignmentsLoadFailed,
    retryAssignments: () => loadAssignments(job.id),
    isLoading,
    setIsLoading,
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
