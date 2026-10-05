'use client';

import { useState } from 'react';

import { parseHoursInputToMinutes } from '@/lib/jobs/planned-working';
import type { JobPriority } from '@/lib/jobs/types';
import type { CreateJobFormContentProps } from './create-job-form-content';
import { useCreateJobNumber } from './use-create-job-number';
import { useCreateJobPlanning } from './use-create-job-planning';
import { useCreateJobProjectLink } from './use-create-job-project-link';
import { useCreateJobSubmit } from './use-create-job-submit';

export type CreateJobForm = ReturnType<typeof useCreateJobForm>;

/** The create-job form's state: its field groups, their defaults and the submit. */
export function useCreateJobForm({
  clients,
  projects = [],
  initialJobNumber,
  defaultProjectId,
  defaultClientId,
  defaultEmployeeIds,
  readOnlyClient,
  defaultDate,
  defaultTime,
  defaultDurationHours,
  onSuccess,
  onDraftChange,
  onSubmitDeferred,
  isActive = true,
}: Omit<CreateJobFormContentProps, 'members' | 'readOnlyProject'>) {
  const { jobNumber, setJobNumber } = useCreateJobNumber({ initialJobNumber, isActive });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [templateVersionId, setTemplateVersionId] = useState('');
  const [assignmentTeamSourceId, setAssignmentTeamSourceId] = useState<string | null>(null);
  const [priority, setPriority] = useState<JobPriority>('mittel');
  const [location, setLocation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const planning = useCreateJobPlanning({
    defaultDate,
    defaultTime,
    defaultDurationHours,
    defaultEmployeeIds,
    isActive,
    onDraftChange,
  });
  const projectLink = useCreateJobProjectLink({
    clients,
    projects,
    defaultClientId,
    defaultProjectId,
    readOnlyClient,
  });
  const { isLoadingProjectDefaults, projectDefaultsLoadFailed } = projectLink;
  const submit = useCreateJobSubmit({
    values: {
      title,
      description,
      clientId: projectLink.clientId,
      projectId: projectLink.projectId,
      jobNumber,
      priority,
      plannedDate: planning.plannedDate,
      plannedTime: planning.plannedTime,
      estimatedHours: planning.estimatedHours,
      plannedWorkingMinutes: planning.plannedWorkingTouched
        ? parseHoursInputToMinutes(planning.plannedWorkingHours)
        : planning.suggestedPlannedWorkingMinutes,
      location,
      siteId: projectLink.siteId,
      contactId: projectLink.contactId,
      selectedEmployees: planning.selectedEmployees,
      assignmentTeamSourceId,
      templateVersionId,
    },
    isBlocked: isLoadingProjectDefaults || projectDefaultsLoadFailed,
    setError,
    onSuccess,
    onSubmitDeferred,
  });

  const formDisabled = submit.isLoading;
  const projectSelectionDisabled = formDisabled || isLoadingProjectDefaults;
  const siteContactDisabled = projectSelectionDisabled || projectDefaultsLoadFailed;
  const submitDisabled = formDisabled || isLoadingProjectDefaults || projectDefaultsLoadFailed;

  return {
    ...planning,
    ...projectLink,
    ...submit,
    jobNumber,
    setJobNumber,
    title,
    setTitle,
    description,
    setDescription,
    templateVersionId,
    setTemplateVersionId,
    priority,
    setPriority,
    location,
    setLocation,
    setAssignmentTeamSourceId,
    error,
    formDisabled,
    projectSelectionDisabled,
    siteContactDisabled,
    submitDisabled,
  };
}
