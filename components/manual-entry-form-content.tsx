'use client';

import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { useReportPending } from '@/hooks/use-report-pending';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { SectionError } from '@/components/ui/section-error';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { useOrganization } from '@/components/organization/organization-context';
import type { CalendarEntryDialogJobOption, CalendarEntryDialogMember } from '@/lib/jobs/types';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { useUserProfile } from '@/components/user/user-profile-context';
import type { CalendarEntryDraft } from '@/components/kalender/calendar-entry-draft';
import { useManualEntryDraftReport, type ManualEntryMode } from '@/components/use-manual-entry-form-draft';
import {
  ManualEntryAssignmentFields,
  ManualEntryTimeFields,
} from '@/components/manual-entry-form-content-fields';
import { useManualEntryMembers } from '@/components/use-manual-entry-form-members';
import { useManualEntrySubmit } from '@/components/use-manual-entry-form-submit';
import { useClosedTimePeriods } from '@/components/zeiterfassung/use-closed-time-periods';

type OrgMember = CalendarEntryDialogMember;
type JobOption = CalendarEntryDialogJobOption;

export interface ManualEntryFormContentProps {
  onSuccess?: ((entries: TimeEntry[]) => void | Promise<void>) | undefined;
  preselectedUserId?: string | undefined;
  preselectedDate?: Date | undefined;
  preselectedClockInTime?: string | undefined;
  preselectedClockOutTime?: string | undefined;
  prefetchedMembers?: OrgMember[] | undefined;
  prefetchedJobs?: JobOption[] | undefined;
  lockEntryMode?: boolean | undefined;
  onDraftChange?: ((draft: CalendarEntryDraft | null) => void) | undefined;
  /** Whether the form is active/visible. Controls data-fetching effects. Defaults to true. */
  isActive?: boolean | undefined;
  /** Reports the save's pending state so the hosting dialog stays open while it runs. */
  onPendingChange?: ((pending: boolean) => void) | undefined;
}

/** The form's fields and who may fill them, seeded from the preselection. */
function useManualEntryFormState({
  preselectedUserId,
  preselectedDate,
  preselectedClockInTime,
  preselectedClockOutTime,
}: Pick<
  ManualEntryFormContentProps,
  'preselectedUserId' | 'preselectedDate' | 'preselectedClockInTime' | 'preselectedClockOutTime'
>) {
  const { activeOrgId, activeOrg } = useOrganization();
  const { profile } = useUserProfile();

  const [entryMode, setEntryMode] = useState<ManualEntryMode>('both');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(preselectedDate ?? new Date());
  const [clockInTime, setClockInTime] = useState(preselectedClockInTime || '09:00');
  const [clockOutTime, setClockOutTime] = useState(preselectedClockOutTime || '17:00');
  const isAdmin = activeOrg?.role === 'admin';
  const isAdminOrManager = activeOrg?.role === 'admin' || activeOrg?.role === 'buero';
  const currentUserId = profile?.id || null;
  const [selectedUserId, setSelectedUserId] = useState(
    preselectedUserId || (isAdminOrManager ? '' : currentUserId || ''),
  );
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const canAssignJob = entryMode === 'clock_in' || entryMode === 'both';

  function changeEntryMode(mode: ManualEntryMode) {
    setEntryMode(mode);
    // An entry without a clock-in cannot carry a job, so a job chosen before the mode change is dropped.
    if (mode !== 'clock_in' && mode !== 'both') setSelectedJobId('');
  }

  return {
    activeOrgId,
    activeOrg,
    isAdmin,
    isAdminOrManager,
    currentUserId,
    entryMode,
    changeEntryMode,
    selectedDate,
    setSelectedDate,
    clockInTime,
    setClockInTime,
    clockOutTime,
    setClockOutTime,
    selectedUserId,
    setSelectedUserId,
    selectedJobId,
    setSelectedJobId,
    canAssignJob,
  };
}

/** The form state, its save, the member and job options and the draft it reports to the calendar. */
function useManualEntryForm({
  onSuccess,
  preselectedUserId,
  preselectedDate,
  preselectedClockInTime,
  preselectedClockOutTime,
  prefetchedMembers,
  prefetchedJobs,
  onDraftChange,
  isActive,
  onPendingChange,
}: Omit<ManualEntryFormContentProps, 'lockEntryMode' | 'isActive'> & { isActive: boolean }) {
  const form = useManualEntryFormState({
    preselectedUserId,
    preselectedDate,
    preselectedClockInTime,
    preselectedClockOutTime,
  });
  const closedPeriods = useClosedTimePeriods(form.activeOrgId, isActive);

  const submit = useManualEntrySubmit({
    activeOrgId: form.activeOrgId,
    isAdmin: form.isAdmin,
    isAdminOrManager: form.isAdminOrManager,
    currentUserId: form.currentUserId,
    entryMode: form.entryMode,
    selectedDate: form.selectedDate,
    clockInTime: form.clockInTime,
    clockOutTime: form.clockOutTime,
    selectedUserId: form.selectedUserId,
    canAssignJob: form.canAssignJob,
    selectedJobId: form.selectedJobId,
    closedPeriods,
    onSuccess,
  });
  useReportPending(submit.isPending, onPendingChange);
  const members = useManualEntryMembers({
    isActive,
    isAdminOrManager: form.isAdminOrManager,
    activeOrgId: form.activeOrgId,
    prefetchedMembers,
  });

  useManualEntryDraftReport({
    isActive,
    onDraftChange,
    isAdminOrManager: form.isAdminOrManager,
    selectedUserId: form.selectedUserId,
    currentUserId: form.currentUserId,
    entryMode: form.entryMode,
    selectedDate: form.selectedDate,
    clockInTime: form.clockInTime,
    clockOutTime: form.clockOutTime,
  });

  const jobSearch = useJobEntityOptions(
    { kind: 'jobs', purpose: 'manual-entry' },
    form.selectedJobId ? [form.selectedJobId] : [],
    (prefetchedJobs ?? []).map((job) => ({
      value: job.id,
      label: job.title,
      description: job.jobNumber ?? undefined,
    })),
  );
  const isOwnBueroEntry = form.activeOrg?.role === 'buero' && form.selectedUserId === form.currentUserId;
  return { ...form, ...submit, ...members, jobSearch, isOwnBueroEntry };
}

export function ManualEntryFormContent({
  onSuccess,
  preselectedUserId,
  preselectedDate,
  preselectedClockInTime,
  preselectedClockOutTime,
  prefetchedMembers,
  prefetchedJobs,
  lockEntryMode,
  onDraftChange,
  isActive = true,
  onPendingChange,
}: ManualEntryFormContentProps) {
  const form = useManualEntryForm({
    onSuccess,
    preselectedUserId,
    preselectedDate,
    preselectedClockInTime,
    preselectedClockOutTime,
    prefetchedMembers,
    prefetchedJobs,
    onDraftChange,
    isActive,
    onPendingChange,
  });

  if (!form.activeOrgId || !form.activeOrg) return null;

  return (
    <form onSubmit={form.handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="space-y-4">
        {form.membersFailure && <SectionError failure={form.membersFailure} />}
        <ManualEntryAssignmentFields
          lockEntryMode={lockEntryMode}
          entryMode={form.entryMode}
          setEntryMode={form.changeEntryMode}
          isAdminOrManager={form.isAdminOrManager}
          memberError={form.fieldErrors.member}
          memberOptions={form.memberOptions}
          selectedUserId={form.selectedUserId}
          setSelectedUserId={form.setSelectedUserId}
          isLoadingMembers={form.isLoadingMembers}
          canAssignJob={form.canAssignJob}
          jobSearch={form.jobSearch}
          selectedJobId={form.selectedJobId}
          setSelectedJobId={form.setSelectedJobId}
          isPending={form.isPending}
        />

        <ManualEntryTimeFields
          entryMode={form.entryMode}
          dateError={form.fieldErrors.date}
          selectedDate={form.selectedDate}
          setSelectedDate={form.setSelectedDate}
          clockInTime={form.clockInTime}
          setClockInTime={form.setClockInTime}
          clockOutTime={form.clockOutTime}
          setClockOutTime={form.setClockOutTime}
        />

        <ErrorText>{form.error}</ErrorText>

        {form.isOwnBueroEntry ? (
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Eigene Nachträge werden zur Freigabe eingereicht. Du kannst sie nicht selbst freigeben.
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button type="submit" className="h-11 sm:h-9" pending={form.isPending}>
          {form.isPending ? 'Speichern…' : 'Speichern'}
        </Button>
      </DialogFooter>
    </form>
  );
}
