'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, CalendarPlus, Clock } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CreateJobFormContent } from '@/components/auftraege/forms/create-job-form-content';
import { SectionError } from '@/components/ui/section-error';
import { ManualEntryFormContent } from '@/components/manual-entry-form-content';
import { readInBackground } from '@/lib/data/background-read-client';
import { useOrganization } from '@/components/organization/organization-context';
import { useLiveView } from '@/hooks/use-live-view';
import type { CalendarEntryDialogMember } from '@/lib/jobs/types';
import type { OrgMemberOption } from '@/components/auftraege/shared/employee-multi-select';
import type { TimeEntry } from '@/lib/time-tracking/types';
import type { CalendarEntryDraft } from './calendar-entry-draft';
import { PlanningEntryForm } from './planning-entry-form';

interface CalendarEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedDate?: Date | undefined;
  preselectedUserId?: string | undefined;
  preselectedClockInTime?: string | undefined;
  preselectedClockOutTime?: string | undefined;
  lockEntryMode?: boolean;
  onManualEntrySuccess?: ((entries: TimeEntry[]) => void | Promise<void>) | undefined;
  onJobSuccess?: (() => void | Promise<void>) | undefined;
  onDraftChange?: (draft: CalendarEntryDraft | null) => void;
}

/** The organization's members for the job and entry tabs; the planning tab reads its own options. */
function useEntryDialogMembers(
  enabled: boolean,
  activeOrgId: string | null,
  activeOrgRole: string | undefined,
) {
  return useLiveView<CalendarEntryDialogMember[]>({
    tables: ['organization_members', 'profiles'],
    enabled,
    resetKey: `${activeOrgId}:${activeOrgRole}`,
    read: async () => {
      if (!activeOrgId) return { ok: false, error: 'member_read_failed' };
      const result = await readInBackground('organization-member-options', { organizationId: activeOrgId });
      if (!result.success) return { ok: false, error: 'member_read_failed' };
      return {
        ok: true,
        data: result.members.map((member) => ({
          userId: member.user_id,
          firstName: member.first_name ?? '',
          lastName: member.last_name ?? '',
          email: member.email,
          role: member.role,
        })),
      };
    },
  });
}

type EntryDialogMemberView = ReturnType<typeof useEntryDialogMembers>;

/** A closed dialog forgets both tabs' drafts. */
function useDraftsClearedOnClose(
  open: boolean,
  jobDraftRef: React.RefObject<CalendarEntryDraft | null>,
  manualDraftRef: React.RefObject<CalendarEntryDraft | null>,
): void {
  useEffect(() => {
    if (open) return;
    jobDraftRef.current = null;
    manualDraftRef.current = null;
  }, [open, jobDraftRef, manualDraftRef]);
}

/** The member options of the job form. */
function useJobMemberOptions(members: CalendarEntryDialogMember[] | undefined): OrgMemberOption[] {
  return useMemo<OrgMemberOption[]>(
    () =>
      (members ?? []).map((member) => ({
        userId: member.userId,
        firstName: member.firstName,
        lastName: member.lastName,
        role: member.role,
      })),
    [members],
  );
}

/** Keeps a tab's latest draft; only the active tab's draft reaches the host. */
function reportTabDraft(
  tab: 'job' | 'entry',
  draft: CalendarEntryDraft | null,
  draftRef: React.RefObject<CalendarEntryDraft | null>,
  activeTabRef: React.RefObject<string>,
  onDraftChange: CalendarEntryDialogProps['onDraftChange'],
): void {
  draftRef.current = draft;
  if (activeTabRef.current === tab) {
    onDraftChange?.(draft);
  }
}

/** The job form's duration from a preselected time range; undefined without a positive range. */
function durationHoursBetween(
  clockInTime: string | undefined,
  clockOutTime: string | undefined,
): string | undefined {
  if (!clockInTime || !clockOutTime) return undefined;
  const [inH, inM] = clockInTime.split(':').map(Number);
  const [outH, outM] = clockOutTime.split(':').map(Number);
  if (inH === undefined || inM === undefined || outH === undefined || outM === undefined) return undefined;
  const totalMin = outH * 60 + outM - (inH * 60 + inM);
  if (totalMin <= 0) return undefined;
  return String(totalMin / 60);
}

function EntryDialogTabsList({ isAdminOrManager }: { isAdminOrManager: boolean }): React.JSX.Element {
  return (
    <TabsList className="h-11 w-full p-0 sm:h-9 sm:p-0.5">
      {isAdminOrManager && (
        <TabsTrigger value="planning" className="h-11 flex-1 gap-1.5 sm:h-8">
          <CalendarPlus className="h-3.5 w-3.5" />
          Termin planen
        </TabsTrigger>
      )}
      <TabsTrigger value="job" className="h-11 flex-1 gap-1.5 sm:h-8">
        <Briefcase className="h-3.5 w-3.5" />
        Auftrag erstellen
      </TabsTrigger>
      <TabsTrigger value="entry" className="h-11 flex-1 gap-1.5 sm:h-8">
        <Clock className="h-3.5 w-3.5" />
        Manuelle Eintragung
      </TabsTrigger>
    </TabsList>
  );
}

type EntryDialogTabsProps = CalendarEntryDialogProps & {
  isAdminOrManager: boolean;
  activeTab: string;
  isFormPending: boolean;
  onActiveTabChange: (nextTab: string) => void;
  memberView: EntryDialogMemberView;
  jobMembers: OrgMemberOption[];
  defaultDurationHours: string | undefined;
  onJobDraftChange: (draft: CalendarEntryDraft | null) => void;
  onManualDraftChange: (draft: CalendarEntryDraft | null) => void;
  onPendingChange: (pending: boolean) => void;
};

/** The member list's load state between the tab panels. */
function EntryDialogMemberState({
  activeTab,
  memberView,
}: {
  activeTab: string;
  memberView: EntryDialogMemberView;
}): React.JSX.Element {
  const isLoadingData = activeTab !== 'planning' && memberView.isLoading;
  // A thrown read leaves `error` null; `isStale` still names the failed refresh.
  const hasDataLoadFailed = activeTab !== 'planning' && (Boolean(memberView.error) || memberView.isStale);
  return (
    <>
      {isLoadingData && (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Referenzdaten werden geladen. Die vorausgefüllten Felder kannst du schon direkt anpassen.
        </div>
      )}
      {hasDataLoadFailed && (
        <SectionError onRetry={() => void memberView.refresh()} retryPending={memberView.isRefreshing}>
          Die Mitarbeiter konnten nicht geladen werden.
        </SectionError>
      )}
    </>
  );
}

/** The three tab panels and the shared load state of the member list between them. */
function EntryDialogTabs({
  onOpenChange,
  preselectedDate,
  preselectedUserId,
  preselectedClockInTime,
  preselectedClockOutTime,
  lockEntryMode,
  onManualEntrySuccess,
  onJobSuccess,
  isAdminOrManager,
  activeTab,
  isFormPending,
  onActiveTabChange,
  memberView,
  jobMembers,
  defaultDurationHours,
  onJobDraftChange,
  onManualDraftChange,
  onPendingChange,
}: EntryDialogTabsProps): React.JSX.Element {
  return (
    <Tabs
      value={activeTab}
      // A tab change unmounts the saving form and would release the dialog mid-request.
      onValueChange={(nextTab) => {
        if (!isFormPending) onActiveTabChange(nextTab);
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <EntryDialogTabsList isAdminOrManager={isAdminOrManager} />

      {isAdminOrManager && (
        <TabsContent value="planning" className="flex min-h-0 flex-1 flex-col">
          <PlanningEntryForm
            defaultDate={preselectedDate}
            defaultTime={preselectedClockInTime}
            defaultUserId={preselectedUserId}
            onPendingChange={onPendingChange}
            onSuccess={async () => {
              onOpenChange(false);
              await onJobSuccess?.();
            }}
          />
        </TabsContent>
      )}

      <EntryDialogMemberState activeTab={activeTab} memberView={memberView} />

      <TabsContent value="job" className="flex min-h-0 flex-1 flex-col">
        <CreateJobFormContent
          members={jobMembers}
          defaultDate={preselectedDate}
          defaultTime={preselectedClockInTime}
          defaultDurationHours={defaultDurationHours}
          defaultEmployeeIds={preselectedUserId ? [preselectedUserId] : undefined}
          isActive={activeTab === 'job'}
          onDraftChange={onJobDraftChange}
          onPendingChange={onPendingChange}
          onSuccess={() => {
            onOpenChange(false);
            // Both callers pass a synchronous refresh; nothing here can reject.
            void onJobSuccess?.();
          }}
        />
      </TabsContent>

      <TabsContent value="entry" className="flex min-h-0 flex-1 flex-col">
        <ManualEntryFormContent
          preselectedDate={preselectedDate}
          preselectedUserId={preselectedUserId}
          preselectedClockInTime={preselectedClockInTime}
          preselectedClockOutTime={preselectedClockOutTime}
          prefetchedMembers={memberView.data}
          lockEntryMode={lockEntryMode}
          isActive={activeTab === 'entry'}
          onDraftChange={onManualDraftChange}
          onPendingChange={onPendingChange}
          onSuccess={async (entries) => {
            await onManualEntrySuccess?.(entries);
            // Close-then-banner: the form itself shows the success banner
            // (M5); this host only closes immediately.
            onOpenChange(false);
          }}
        />
      </TabsContent>
    </Tabs>
  );
}

export function CalendarEntryDialog(props: CalendarEntryDialogProps) {
  const {
    open,
    onOpenChange,
    preselectedClockInTime,
    preselectedClockOutTime,
    lockEntryMode,
    onDraftChange,
  } = props;
  const { activeOrg, activeOrgId } = useOrganization();
  const isAdminOrManager = activeOrg?.role === 'admin' || activeOrg?.role === 'buero';
  const initialTab = lockEntryMode || !isAdminOrManager ? 'entry' : 'planning';
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  // The running save of the active tab's form keeps the dialog open until it answers.
  const [isFormPending, setIsFormPending] = useState(false);
  const activeTabRef = useRef(activeTab);
  const jobDraftRef = useRef<CalendarEntryDraft | null>(null);
  const manualDraftRef = useRef<CalendarEntryDraft | null>(null);
  const memberView = useEntryDialogMembers(
    open && activeTab !== 'planning' && isAdminOrManager && Boolean(activeOrgId),
    activeOrgId,
    activeOrg?.role,
  );

  useDraftsClearedOnClose(open, jobDraftRef, manualDraftRef);

  const handleJobDraftChange = useCallback(
    (draft: CalendarEntryDraft | null) =>
      reportTabDraft('job', draft, jobDraftRef, activeTabRef, onDraftChange),
    [onDraftChange],
  );

  const handleActiveTabChange = useCallback(
    (nextTab: string) => {
      activeTabRef.current = nextTab;
      setActiveTab(nextTab);
      onDraftChange?.(
        nextTab === 'job' ? jobDraftRef.current : nextTab === 'entry' ? manualDraftRef.current : null,
      );
    },
    [onDraftChange],
  );

  const handleManualDraftChange = useCallback(
    (draft: CalendarEntryDraft | null) =>
      reportTabDraft('entry', draft, manualDraftRef, activeTabRef, onDraftChange),
    [onDraftChange],
  );

  const defaultDurationHours = useMemo(
    () => durationHoursBetween(preselectedClockInTime, preselectedClockOutTime),
    [preselectedClockInTime, preselectedClockOutTime],
  );

  const jobMembers = useJobMemberOptions(memberView.data);

  useEffect(() => {
    if (open || !activeOrgId) return;
    activeTabRef.current = initialTab;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset while closed so reopening never mounts an unrelated form and starts its reads
    setActiveTab(initialTab);
  }, [activeOrgId, initialTab, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isFormPending}>
      <DialogContent workspace>
        <DialogHeader>
          <DialogTitle>Kalendereintrag erstellen</DialogTitle>
          <DialogDescription>
            Plane einen Termin, erstelle einen Auftrag oder erfasse tatsächliche Arbeitszeit.
          </DialogDescription>
        </DialogHeader>

        <EntryDialogTabs
          {...props}
          isAdminOrManager={isAdminOrManager}
          activeTab={activeTab}
          isFormPending={isFormPending}
          onActiveTabChange={handleActiveTabChange}
          memberView={memberView}
          jobMembers={jobMembers}
          defaultDurationHours={defaultDurationHours}
          onJobDraftChange={handleJobDraftChange}
          onManualDraftChange={handleManualDraftChange}
          onPendingChange={setIsFormPending}
        />
      </DialogContent>
    </Dialog>
  );
}
