'use client';

import { useState, useEffect, useMemo } from 'react';
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
import { getOrgClients } from '@/lib/clients/actions';
import { getOrgProjects } from '@/lib/projects/actions';
import { getOrgMembersAction } from '@/lib/members/actions';
import { useOrganization } from '@/components/organization/organization-context';
import type { Client, ProjectWithDetails } from '@/lib/jobs/types';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
import type { TimeEntry } from '@/lib/time-tracking/types';

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
  const { activeOrgId } = useOrganization();
  const [activeTab, setActiveTab] = useState<string>('job');

  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<ProjectWithDetails[]>([]);
  const [members, setMembers] = useState<OrgMemberOption[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const defaultDurationHours = useMemo(() => {
    if (!preselectedClockInTime || !preselectedClockOutTime) return undefined;
    const [inH, inM] = preselectedClockInTime.split(':').map(Number);
    const [outH, outM] = preselectedClockOutTime.split(':').map(Number);
    const totalMin = (outH * 60 + outM) - (inH * 60 + inM);
    if (totalMin <= 0) return undefined;
    return String(totalMin / 60);
  }, [preselectedClockInTime, preselectedClockOutTime]);

  useEffect(() => {
    if (!open || !activeOrgId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reopening the dialog should always start on the creation tab
    setActiveTab('job');

    let cancelled = false;
    setIsLoadingData(true);

    Promise.all([
      getOrgClients(),
      getOrgProjects(),
      getOrgMembersAction(activeOrgId),
    ]).then(([clientsResult, projectsResult, membersResult]) => {
      if (cancelled) return;
      if (clientsResult.success) setClients(clientsResult.clients);
      if (projectsResult.success) setProjects(projectsResult.projects);
      if (membersResult.success) {
        setMembers(
          (membersResult.members || []).map((m: { user_id: string; first_name: string | null; last_name: string | null; role: string }) => ({
            userId: m.user_id,
            firstName: m.first_name || '',
            lastName: m.last_name || '',
            role: m.role,
          }))
        );
      }
      setIsLoadingData(false);
    });

    return () => { cancelled = true; };
  }, [open, activeOrgId]);

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

          <TabsContent value="job">
            {isLoadingData ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Daten werden geladen...
              </div>
            ) : (
              <CreateJobFormContent
                clients={clients}
                members={members}
                projects={projects}
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
            )}
          </TabsContent>

          <TabsContent value="entry">
            <ManualEntryFormContent
              preselectedDate={preselectedDate}
              preselectedUserId={preselectedUserId}
              preselectedClockInTime={preselectedClockInTime}
              preselectedClockOutTime={preselectedClockOutTime}
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
