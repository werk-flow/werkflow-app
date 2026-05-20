'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Briefcase, FolderKanban, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CreateJobFormContent } from './create-job-form-content';
import { CreateProjectFormContent } from './create-project-form-content';
import type { OrgMemberOption } from './employee-multi-select';
import type { Client, Job, Project, ProjectWithDetails } from '@/lib/jobs/types';

interface CreateAuftragProjectDialogProps {
  clients: Client[];
  members: OrgMemberOption[];
  projects?: ProjectWithDetails[];
  jobs: Job[];
  defaultClientId?: string;
  defaultEmployeeIds?: string[];
  readOnlyClient?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onJobCreated?: (payload: {
    job: Job;
    assignedUserIds: string[];
  }) => void | Promise<void>;
  onProjectCreated?: (payload: {
    project: Project;
    linkedJobIds: string[];
  }) => void | Promise<void>;
}

export function CreateAuftragProjectDialog({
  clients,
  members,
  projects = [],
  jobs,
  defaultClientId,
  defaultEmployeeIds,
  readOnlyClient,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onJobCreated,
  onProjectCreated,
}: CreateAuftragProjectDialogProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('job');

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled
    ? (value: boolean) => controlledOnOpenChange?.(value)
    : setInternalOpen;

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the dialog should always reopen on the default tab
    setActiveTab('job');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button size="default" className="gap-2">
            <Plus className="size-4" />
            <span className="hidden sm:inline">Erstellen</span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-[540px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Neuen Auftrag oder Projekt erstellen</DialogTitle>
          <DialogDescription>
            Erstelle einen neuen Auftrag oder ein neues Projekt für deine
            Organisation.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="job" className="flex-1 gap-1.5">
              <Briefcase className="h-3.5 w-3.5" />
              Auftrag erstellen
            </TabsTrigger>
            <TabsTrigger value="project" className="flex-1 gap-1.5">
              <FolderKanban className="h-3.5 w-3.5" />
              Projekt erstellen
            </TabsTrigger>
          </TabsList>

          <TabsContent value="job">
            <CreateJobFormContent
              clients={clients}
              members={members}
              projects={projects}
              defaultClientId={defaultClientId}
              defaultEmployeeIds={defaultEmployeeIds}
              readOnlyClient={readOnlyClient}
              isActive={activeTab === 'job'}
              onSuccess={async (payload) => {
                setOpen(false);
                if (onJobCreated) {
                  await onJobCreated(payload);
                  return;
                }
                router.refresh();
              }}
            />
          </TabsContent>

          <TabsContent value="project">
            <CreateProjectFormContent
              clients={clients}
              jobs={jobs}
              defaultClientId={defaultClientId}
              readOnlyClient={readOnlyClient}
              isActive={activeTab === 'project'}
              onSuccess={async (payload) => {
                setOpen(false);
                if (onProjectCreated) {
                  await onProjectCreated(payload);
                  return;
                }
                router.refresh();
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
