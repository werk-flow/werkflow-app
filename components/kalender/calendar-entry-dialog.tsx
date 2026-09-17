'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, CalendarPlus, Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CreateJobFormContent } from '@/components/auftraege/create-job-form-content';
import { ManualEntryFormContent } from '@/components/manual-entry-form-content';
import { getOrgMembersAction } from '@/lib/members/actions';
import { useOrganization } from '@/components/organization/organization-context';
import { useLiveView } from '@/hooks/use-live-view';
import type {
  CalendarEntryDialogMember,
} from '@/lib/jobs/types';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
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
  const [activeTab, setActiveTab] = useState<string>('job');
  const activeTabRef = useRef(activeTab);
  const jobDraftRef = useRef<CalendarEntryDraft | null>(null);
  const manualDraftRef = useRef<CalendarEntryDraft | null>(null);
  const isAdminOrManager = activeOrg?.role === 'admin' || activeOrg?.role === 'buero';
  const memberView = useLiveView<CalendarEntryDialogMember[]>({
    tables: ['organization_members', 'profiles'],
    enabled: open && isAdminOrManager && Boolean(activeOrgId),
    resetKey: `${activeOrgId}:${activeOrg?.role}`,
    read: async () => {
      if (!activeOrgId) return { ok: false, error: 'member_read_failed' };
      const result = await getOrgMembersAction(activeOrgId).catch(() => ({ success: false as const }));
      if (!result.success) return { ok: false, error: 'member_read_failed' };
      return { ok: true, data: result.members.map((member) => ({
        userId: member.user_id, firstName: member.first_name ?? '', lastName: member.last_name ?? '',
        email: member.email, role: member.role,
      })) };
    },
  });
  const isLoadingData = memberView.isLoading;
  const hasDataLoadFailed = Boolean(memberView.error);

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
    [onDraftChange]
  );

  const handleActiveTabChange = useCallback(
    (nextTab: string) => {
      activeTabRef.current = nextTab;
      setActiveTab(nextTab);
      onDraftChange?.(
        nextTab === 'job'
          ? jobDraftRef.current
          : nextTab === 'entry'
            ? manualDraftRef.current
            : null
      );
    },
    [onDraftChange]
  );

  const handleManualDraftChange = useCallback(
    (draft: CalendarEntryDraft | null) => {
      manualDraftRef.current = draft;
      if (activeTabRef.current === 'entry') {
        onDraftChange?.(draft);
      }
    },
    [onDraftChange]
  );

  const defaultDurationHours = useMemo(() => {
    if (!preselectedClockInTime || !preselectedClockOutTime) return undefined;
    const [inH, inM] = preselectedClockInTime.split(':').map(Number);
    const [outH, outM] = preselectedClockOutTime.split(':').map(Number);
    if (inH === undefined || inM === undefined || outH === undefined || outM === undefined) return undefined;
    const totalMin = (outH * 60 + outM) - (inH * 60 + inM);
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
    [memberView.data]
  );

  useEffect(() => {
    if (!open || !activeOrgId) return;
    const initialTab = lockEntryMode || !isAdminOrManager ? 'entry' : 'planning';
    activeTabRef.current = initialTab;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reopening resets the user's previous tab to the role-appropriate creation tab
    setActiveTab(initialTab);
  }, [activeOrgId, isAdminOrManager, lockEntryMode, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[540px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Kalendereintrag erstellen</DialogTitle>
          <DialogDescription>
            Plane einen Termin, erstelle einen Auftrag oder erfasse tatsächliche
            Arbeitszeit.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={handleActiveTabChange} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="w-full">
            {isAdminOrManager && (
              <TabsTrigger value="planning" className="flex-1 gap-1.5">
                <CalendarPlus className="h-3.5 w-3.5" />
                Termin planen
              </TabsTrigger>
            )}
            <TabsTrigger value="job" className="flex-1 gap-1.5">
              <Briefcase className="h-3.5 w-3.5" />
              Auftrag erstellen
            </TabsTrigger>
            <TabsTrigger value="entry" className="flex-1 gap-1.5">
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
                onSuccess={async () => {
                  onOpenChange(false);
                  await onJobSuccess?.();
                }}
              />
            </TabsContent>
          )}

          {isLoadingData && (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Referenzdaten werden geladen. Die vorausgefüllten Felder kannst du
              schon direkt anpassen.
            </div>
          )}
          {hasDataLoadFailed && (
            <ErrorText>
              Die Mitarbeiter konnten nicht geladen werden.
              Bitte schließe den Dialog und öffne ihn erneut.
            </ErrorText>
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
              onSuccess={() => {
                onOpenChange(false);
                onJobSuccess?.();
              }}
            />
          </TabsContent>

          <TabsContent value="entry">
            <ManualEntryFormContent
              preselectedDate={preselectedDate}
              preselectedUserId={preselectedUserId}
              preselectedClockInTime={preselectedClockInTime}
              preselectedClockOutTime={preselectedClockOutTime}
              prefetchedMembers={memberView.data}
              lockEntryMode={lockEntryMode}
              isActive={activeTab === 'entry'}
              onDraftChange={handleManualDraftChange}
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
