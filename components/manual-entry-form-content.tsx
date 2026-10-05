'use client';

import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { useReportPending } from '@/hooks/use-report-pending';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionsLoadError } from '@/components/auftraege/shared/options-load-error';
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

  const { handleSubmit, isPending, error, fieldErrors } = useManualEntrySubmit({
    activeOrgId,
    isAdmin,
    isAdminOrManager,
    currentUserId,
    entryMode,
    selectedDate,
    clockInTime,
    clockOutTime,
    selectedUserId,
    canAssignJob,
    selectedJobId,
    onSuccess,
  });
  useReportPending(isPending, onPendingChange);
  const { memberOptions, isLoadingMembers, loadError, retryLoadMembers } = useManualEntryMembers({
    isActive,
    isAdminOrManager,
    activeOrgId,
    prefetchedMembers,
  });

  function changeEntryMode(mode: ManualEntryMode) {
    setEntryMode(mode);
    // An entry without a clock-in cannot carry a job, so a job chosen before the mode change is dropped.
    if (mode !== 'clock_in' && mode !== 'both') setSelectedJobId('');
  }

  useManualEntryDraftReport({
    isActive,
    onDraftChange,
    isAdminOrManager,
    selectedUserId,
    currentUserId,
    entryMode,
    selectedDate,
    clockInTime,
    clockOutTime,
  });

  const jobSearch = useJobEntityOptions(
    { kind: 'jobs', purpose: 'manual-entry' },
    selectedJobId ? [selectedJobId] : [],
    (prefetchedJobs ?? []).map((job) => ({
      value: job.id,
      label: job.title,
      description: job.jobNumber ?? undefined,
    })),
  );
  const isOwnBueroEntry = activeOrg?.role === 'buero' && selectedUserId === currentUserId;

  if (!activeOrgId || !activeOrg) return null;

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="space-y-4">
        <OptionsLoadError error={loadError} onRetry={retryLoadMembers} retrying={isLoadingMembers} />
        <ManualEntryAssignmentFields
          lockEntryMode={lockEntryMode}
          entryMode={entryMode}
          setEntryMode={changeEntryMode}
          isAdminOrManager={isAdminOrManager}
          memberError={fieldErrors.member}
          memberOptions={memberOptions}
          selectedUserId={selectedUserId}
          setSelectedUserId={setSelectedUserId}
          isLoadingMembers={isLoadingMembers}
          canAssignJob={canAssignJob}
          jobSearch={jobSearch}
          selectedJobId={selectedJobId}
          setSelectedJobId={setSelectedJobId}
          isPending={isPending}
        />

        <ManualEntryTimeFields
          entryMode={entryMode}
          dateError={fieldErrors.date}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          clockInTime={clockInTime}
          setClockInTime={setClockInTime}
          clockOutTime={clockOutTime}
          setClockOutTime={setClockOutTime}
        />

        <ErrorText>{error}</ErrorText>

        {isOwnBueroEntry ? (
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Eigene Nachträge werden zur Freigabe eingereicht. Du kannst sie nicht selbst freigeben.
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button type="submit" className="h-11 sm:h-9" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Speichern…
            </>
          ) : (
            'Speichern'
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
