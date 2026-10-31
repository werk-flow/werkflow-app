'use client';

import { useState } from 'react';

import { parseHoursInputToMinutes } from '@/lib/jobs/planned-working';
import type { JobPriority } from '@/lib/jobs/types';
import type { CreateJobFormContentProps } from './create-job-form-content';
import type { CreateJobFormValues } from './create-job-submission';
import { useCreateJobNumber } from './use-create-job-number';
import { useCreateJobPlanning } from './use-create-job-planning';
import { useCreateJobProjectLink } from './use-create-job-project-link';
import { useCreateJobSubmit } from './use-create-job-submit';

export type CreateJobForm = ReturnType<typeof useCreateJobForm>;

/** The submit's values: the form's own fields with the planning and project-link groups. */
function createJobFormValues(
  fields: Pick<
    CreateJobFormValues,
    | 'title'
    | 'description'
    | 'jobNumber'
    | 'priority'
    | 'location'
    | 'assignmentTeamSourceId'
    | 'templateVersionId'
  >,
  planning: ReturnType<typeof useCreateJobPlanning>,
  projectLink: ReturnType<typeof useCreateJobProjectLink>,
): CreateJobFormValues {
  const { title, description, jobNumber, priority, location, assignmentTeamSourceId, templateVersionId } =
    fields;
  return {
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
  };
}

/** The create-job form's state: its field groups, their defaults and the submit. */
export function useCreateJobForm({
  initialJobNumber,
  defaultProject,
  defaultClient,
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
  const projectLink = useCreateJobProjectLink({ defaultClient, defaultProject, readOnlyClient });
  const { isLoadingProjectDefaults } = projectLink;
  const projectDefaultsLoadFailed = projectLink.projectDefaultsFailure !== null;
  const submit = useCreateJobSubmit({
    values: createJobFormValues(
      { title, description, jobNumber, priority, location, assignmentTeamSourceId, templateVersionId },
      planning,
      projectLink,
    ),
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
