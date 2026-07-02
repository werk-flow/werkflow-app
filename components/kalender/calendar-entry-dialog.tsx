'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CreateJobFormContent } from '@/components/auftraege/create-job-form-content';
import { ManualEntryFormContent } from '@/components/manual-entry-form-content';
import { getCalendarEntryDialogOptions } from '@/lib/jobs/actions';
import { useOrganization } from '@/components/organization/organization-context';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import type {
  CalendarEntryDialogJobOption,
  CalendarEntryDialogMember,
  Client,
  ProjectWithDetails,
} from '@/lib/jobs/types';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
import type { TimeEntry } from '@/lib/time-tracking/types';

type CalendarEntryDialogData = {
  clients: Client[];
  projects: ProjectWithDetails[];
  members: CalendarEntryDialogMember[];
  manualEntryJobs: CalendarEntryDialogJobOption[];
  nextJobNumber: string | null;
};

const dialogDataCache = new Map<string, CalendarEntryDialogData>();
const dialogDataPromiseCache = new Map<
  string,
  Promise<CalendarEntryDialogData | null>
>();

async function loadCalendarEntryDialogData(
  organizationId: string
): Promise<CalendarEntryDialogData | null> {
  const cached = dialogDataCache.get(organizationId);
  if (cached) {
    return cached;
  }

  const pending = dialogDataPromiseCache.get(organizationId);
  if (pending) {
    return pending;
  }

  const promise = getCalendarEntryDialogOptions()
    .then((result) => {
      if (!result.success) {
        return null;
      }

      const data: CalendarEntryDialogData = {
        clients: result.clients,
        projects: result.projects,
        members: result.members,
        manualEntryJobs: result.manualEntryJobs,
        nextJobNumber: result.nextJobNumber,
      };
      dialogDataCache.set(organizationId, data);
      return data;
    })
    .catch((error) => {
      console.error('Error loading calendar dialog options:', error);
      return null;
    })
    .finally(() => {
      dialogDataPromiseCache.delete(organizationId);
    });

  dialogDataPromiseCache.set(organizationId, promise);
  return promise;
}

interface CalendarEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedDate?: Date;
  preselectedUserId?: string;
  preselectedClockInTime?: string;
  preselectedClockOutTime?: string;
  lockEntryMode?: boolean;
  onManualEntrySuccess?: (entries: TimeEntry[]) => void | Promise<void>;
  onJobSuccess?: () => void | Promise<void>;
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
}: CalendarEntryDialogProps) {
  const { activeOrg, activeOrgId } = useOrganization();
  const [activeTab, setActiveTab] = useState<string>('job');
  const [loadedDialogData, setLoadedDialogData] = useState<{
    organizationId: string;
    data: CalendarEntryDialogData | null;
  } | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(
    activeOrgId ? dialogDataPromiseCache.has(activeOrgId) : false
  );
  const isAdminOrManager =
    activeOrg?.role === 'admin' || activeOrg?.role === 'buero';
  const dialogData = useMemo(() => {
    if (!activeOrgId) {
      return null;
    }

    const cached = dialogDataCache.get(activeOrgId);
    if (cached) {
      return cached;
    }

    if (loadedDialogData?.organizationId === activeOrgId) {
      return loadedDialogData.data;
    }

    return null;
  }, [activeOrgId, loadedDialogData]);

  const defaultDurationHours = useMemo(() => {
    if (!preselectedClockInTime || !preselectedClockOutTime) return undefined;
    const [inH, inM] = preselectedClockInTime.split(':').map(Number);
    const [outH, outM] = preselectedClockOutTime.split(':').map(Number);
    const totalMin = (outH * 60 + outM) - (inH * 60 + inM);
    if (totalMin <= 0) return undefined;
    return String(totalMin / 60);
  }, [preselectedClockInTime, preselectedClockOutTime]);

  const jobMembers = useMemo<OrgMemberOption[]>(
    () =>
      (dialogData?.members ?? []).map((member) => ({
        userId: member.userId,
        firstName: member.firstName,
        lastName: member.lastName,
        role: member.role,
      })),
    [dialogData]
  );

  const hydrateDialogData = useCallback(
    async (organizationId: string) => {
      const hasCachedData = dialogDataCache.has(organizationId);
      setIsLoadingData(!hasCachedData);

      const data = await loadCalendarEntryDialogData(organizationId);
      setLoadedDialogData({ organizationId, data });
      setIsLoadingData(false);
      return data;
    },
    []
  );

  const invalidateDialogData = useCallback(() => {
    if (!activeOrgId || !isAdminOrManager) return;

    dialogDataCache.delete(activeOrgId);
    dialogDataPromiseCache.delete(activeOrgId);
    setLoadedDialogData((current) =>
      current?.organizationId === activeOrgId ? null : current
    );

    if (open) {
      void hydrateDialogData(activeOrgId);
    }
  }, [activeOrgId, hydrateDialogData, isAdminOrManager, open]);

  useRealtimeEvent('jobs', invalidateDialogData);
  useRealtimeEvent('projects', invalidateDialogData);
  useRealtimeEvent('clients', invalidateDialogData);
  useRealtimeEvent('job_assignments', invalidateDialogData);
  useRealtimeEvent('organization_members', invalidateDialogData);
  useRealtimeEvent('profiles', invalidateDialogData);

  useEffect(() => {
    if (!activeOrgId || !isAdminOrManager || dialogDataCache.has(activeOrgId)) {
      return;
    }

    let cancelled = false;

    loadCalendarEntryDialogData(activeOrgId)
      .then((data) => {
        if (cancelled) return;
        setLoadedDialogData({ organizationId: activeOrgId, data });
      });

    return () => {
      cancelled = true;
    };
  }, [activeOrgId, isAdminOrManager]);

  useEffect(() => {
    if (!open || !activeOrgId || !isAdminOrManager) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reopening the dialog should always start on the creation tab
    setActiveTab('job');

    if (dialogDataCache.has(activeOrgId)) {
      return;
    }

    void hydrateDialogData(activeOrgId);
  }, [activeOrgId, hydrateDialogData, isAdminOrManager, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-[540px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Kalendereintrag erstellen</DialogTitle>
          <DialogDescription>
            Erstelle einen neuen Auftrag oder eine manuelle Zeiterfassung.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="job" className="flex-1 gap-1.5">
              <Briefcase className="h-3.5 w-3.5" />
              Auftrag erstellen
            </TabsTrigger>
            <TabsTrigger value="entry" className="flex-1 gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Manuelle Eintragung
            </TabsTrigger>
          </TabsList>

          {isLoadingData && !dialogData && (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Referenzdaten werden geladen. Die vorausgefüllten Felder kannst du
              schon direkt anpassen.
            </div>
          )}

          <TabsContent value="job">
            <CreateJobFormContent
              clients={dialogData?.clients ?? []}
              members={jobMembers}
              projects={dialogData?.projects ?? []}
              initialJobNumber={dialogData?.nextJobNumber}
              defaultDate={preselectedDate}
              defaultTime={preselectedClockInTime}
              defaultDurationHours={defaultDurationHours}
              defaultEmployeeIds={preselectedUserId ? [preselectedUserId] : undefined}
              isActive={activeTab === 'job'}
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
              prefetchedMembers={dialogData?.members}
              prefetchedJobs={dialogData?.manualEntryJobs}
              lockEntryMode={lockEntryMode}
              isActive={activeTab === 'entry'}
              onSuccess={async (entries) => {
                await onManualEntrySuccess?.(entries);
                setTimeout(() => onOpenChange(false), 1500);
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
