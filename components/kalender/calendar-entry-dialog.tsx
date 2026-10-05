'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, CalendarPlus, Clock } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CreateJobFormContent } from '@/components/auftraege/forms/create-job-form-content';
import { OptionsLoadError } from '@/components/auftraege/shared/options-load-error';
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

export function CalendarEntryDialog({
  open,
  onOpenChange,
  preselectedDate,
  preselectedUserId,
  preselectedClockInTime,
  preselectedClockOutTime,
  lockEntryMode,
  onManualEntrySuccess,
  onJobSuccess,
  onDraftChange,
}: CalendarEntryDialogProps) {
  const { activeOrg, activeOrgId } = useOrganization();
  const isAdminOrManager = activeOrg?.role === 'admin' || activeOrg?.role === 'buero';
  const initialTab = lockEntryMode || !isAdminOrManager ? 'entry' : 'planning';
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  // The running save of the active tab's form keeps the dialog open until it answers.
  const [isFormPending, setIsFormPending] = useState(false);
  const activeTabRef = useRef(activeTab);
  const jobDraftRef = useRef<CalendarEntryDraft | null>(null);
  const manualDraftRef = useRef<CalendarEntryDraft | null>(null);
  const memberView = useLiveView<CalendarEntryDialogMember[]>({
    tables: ['organization_members', 'profiles'],
    enabled: open && activeTab !== 'planning' && isAdminOrManager && Boolean(activeOrgId),
    resetKey: `${activeOrgId}:${activeOrg?.role}`,
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
  const isLoadingData = activeTab !== 'planning' && memberView.isLoading;
  const hasDataLoadFailed = activeTab !== 'planning' && Boolean(memberView.error);

  useEffect(() => {
    if (open) return;
    jobDraftRef.current = null;
    manualDraftRef.current = null;
  }, [open]);

  const handleJobDraftChange = useCallback(
    (draft: CalendarEntryDraft | null) => {
      jobDraftRef.current = draft;
      if (activeTabRef.current === 'job') {
        onDraftChange?.(draft);
      }
    },
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
    (draft: CalendarEntryDraft | null) => {
      manualDraftRef.current = draft;
      if (activeTabRef.current === 'entry') {
        onDraftChange?.(draft);
      }
    },
    [onDraftChange],
  );

  const defaultDurationHours = useMemo(() => {
    if (!preselectedClockInTime || !preselectedClockOutTime) return undefined;
    const [inH, inM] = preselectedClockInTime.split(':').map(Number);
    const [outH, outM] = preselectedClockOutTime.split(':').map(Number);
    if (inH === undefined || inM === undefined || outH === undefined || outM === undefined) return undefined;
    const totalMin = outH * 60 + outM - (inH * 60 + inM);
    if (totalMin <= 0) return undefined;
    return String(totalMin / 60);
  }, [preselectedClockInTime, preselectedClockOutTime]);

  const jobMembers = useMemo<OrgMemberOption[]>(
    () =>
      (memberView.data ?? []).map((member) => ({
        userId: member.userId,
        firstName: member.firstName,
        lastName: member.lastName,
        role: member.role,
      })),
    [memberView.data],
  );

  useEffect(() => {
    if (open || !activeOrgId) return;
    activeTabRef.current = initialTab;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset while closed so reopening never mounts an unrelated form and starts its reads
    setActiveTab(initialTab);
  }, [activeOrgId, initialTab, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isFormPending}>
      <DialogContent workspace onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Kalendereintrag erstellen</DialogTitle>
          <DialogDescription>
            Plane einen Termin, erstelle einen Auftrag oder erfasse tatsächliche Arbeitszeit.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          // A tab change unmounts the saving form and would release the dialog mid-request.
          onValueChange={(nextTab) => {
            if (!isFormPending) handleActiveTabChange(nextTab);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
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

          {isAdminOrManager && (
            <TabsContent value="planning" className="flex min-h-0 flex-1 flex-col">
              <PlanningEntryForm
                defaultDate={preselectedDate}
                defaultTime={preselectedClockInTime}
                defaultUserId={preselectedUserId}
                onPendingChange={setIsFormPending}
                onSuccess={async () => {
                  onOpenChange(false);
                  await onJobSuccess?.();
                }}
              />
            </TabsContent>
          )}

          {isLoadingData && (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Referenzdaten werden geladen. Die vorausgefüllten Felder kannst du schon direkt anpassen.
            </div>
          )}
          {hasDataLoadFailed && (
            <OptionsLoadError
              error="Die Mitarbeiter konnten nicht geladen werden."
              onRetry={() => void memberView.refresh()}
              retrying={memberView.isRefreshing}
            />
          )}

          <TabsContent value="job" className="flex min-h-0 flex-1 flex-col">
            <CreateJobFormContent
              clients={[]}
              members={jobMembers}
              projects={[]}
              defaultDate={preselectedDate}
              defaultTime={preselectedClockInTime}
              defaultDurationHours={defaultDurationHours}
              defaultEmployeeIds={preselectedUserId ? [preselectedUserId] : undefined}
              isActive={activeTab === 'job'}
              onDraftChange={handleJobDraftChange}
              onPendingChange={setIsFormPending}
              onSuccess={() => {
                onOpenChange(false);
                onJobSuccess?.();
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
              onDraftChange={handleManualDraftChange}
              onPendingChange={setIsFormPending}
              onSuccess={async (entries) => {
                await onManualEntrySuccess?.(entries);
                // Close-then-banner: the form itself shows the success banner
                // (M5); this host only closes immediately.
                onOpenChange(false);
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
