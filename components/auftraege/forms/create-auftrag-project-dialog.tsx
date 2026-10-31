'use client';

import { useState } from 'react';
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
import { CreateJobFormContent, type CreateJobSubmission } from './create-job-form-content';
import { CreateProjectFormContent, type CreateProjectSubmission } from './create-project-form-content';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import type { Job, Project } from '@/lib/jobs/types';
import type { ClientSelectItem } from '../shared/client-select-with-create';

interface CreateAuftragProjectDialogProps {
  members: OrgMemberOption[];
  jobs: Job[];
  defaultClient?: ClientSelectItem | undefined;
  defaultEmployeeIds?: string[] | undefined;
  readOnlyClient?: boolean | undefined;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onJobCreated?: (payload: { job: Job; assignedUserIds: string[] }) => void | Promise<void>;
  onProjectCreated?: (payload: { project: Project; linkedJobIds: string[] }) => void | Promise<void>;
  /**
   * Deferred submit (feedback canon, create from a dialog): when set, the
   * dialog closes as soon as the form validates and the list owns the server
   * call, the pending row, and the result. `onJobCreated` /
   * `onProjectCreated` are not called on that path.
   */
  onJobSubmit?: (submission: CreateJobSubmission) => void;
  onProjectSubmit?: (submission: CreateProjectSubmission) => void;
}

/** The open state, controlled or internal, and the active tab that every opening resets. */
function useCreateAuftragProjectDialogState(
  controlledOpen: boolean | undefined,
  controlledOnOpenChange: ((open: boolean) => void) | undefined,
) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('job');
  const [isCreatingJob, setIsCreatingJob] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (value: boolean) => controlledOnOpenChange?.(value) : setInternalOpen;

  // Every opening starts on the default tab, set during render, never in an effect.
  const [adoptedOpen, setAdoptedOpen] = useState(false);
  if (open !== adoptedOpen) {
    setAdoptedOpen(open);
    if (open) setActiveTab('job');
  }

  return {
    activeTab,
    setActiveTab,
    isCreatingJob,
    setIsCreatingJob,
    isCreatingProject,
    setIsCreatingProject,
    isControlled,
    open,
    setOpen,
  };
}

function CreateAuftragProjectTrigger() {
  return (
    <DialogTrigger asChild>
      <Button size="default" className="gap-2">
        <Plus className="size-4" />
        <span className="sr-only sm:not-sr-only">Erstellen</span>
      </Button>
    </DialogTrigger>
  );
}

function CreateAuftragProjectTabsList() {
  return (
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
  );
}

interface CreateAuftragTabProps {
  isActive: boolean;
  onPendingChange: (pending: boolean) => void;
  setOpen: (open: boolean) => void;
  defaultClient: ClientSelectItem | undefined;
  readOnlyClient: boolean | undefined;
}

interface CreateAuftragJobTabProps extends CreateAuftragTabProps {
  members: OrgMemberOption[];
  defaultEmployeeIds: string[] | undefined;
  onJobSubmit: CreateAuftragProjectDialogProps['onJobSubmit'];
  onJobCreated: CreateAuftragProjectDialogProps['onJobCreated'];
}

interface CreateAuftragProjectTabProps extends CreateAuftragTabProps {
  jobs: Job[];
  onProjectSubmit: CreateAuftragProjectDialogProps['onProjectSubmit'];
  onProjectCreated: CreateAuftragProjectDialogProps['onProjectCreated'];
}

function CreateAuftragJobTab({
  members,
  defaultClient,
  defaultEmployeeIds,
  readOnlyClient,
  isActive,
  onPendingChange,
  setOpen,
  onJobSubmit,
  onJobCreated,
}: CreateAuftragJobTabProps) {
  return (
    <TabsContent value="job" className="flex min-h-0 flex-1 flex-col">
      <CreateJobFormContent
        members={members}
        defaultClient={defaultClient}
        defaultEmployeeIds={defaultEmployeeIds}
        readOnlyClient={readOnlyClient}
        isActive={isActive}
        onPendingChange={onPendingChange}
        onSubmitDeferred={
          onJobSubmit
            ? (submission) => {
                setOpen(false);
                onJobSubmit(submission);
              }
            : undefined
        }
        // createJob's response renders the route, so no refresh follows.
        onSuccess={async (payload) => {
          setOpen(false);
          await onJobCreated?.(payload);
        }}
      />
    </TabsContent>
  );
}

function CreateAuftragProjectTab({
  jobs,
  defaultClient,
  readOnlyClient,
  isActive,
  onPendingChange,
  setOpen,
  onProjectSubmit,
  onProjectCreated,
}: CreateAuftragProjectTabProps) {
  return (
    <TabsContent value="project" className="flex min-h-0 flex-1 flex-col">
      <CreateProjectFormContent
        jobs={jobs}
        defaultClient={defaultClient}
        readOnlyClient={readOnlyClient}
        isActive={isActive}
        onPendingChange={onPendingChange}
        onSubmitDeferred={
          onProjectSubmit
            ? (submission) => {
                setOpen(false);
                onProjectSubmit(submission);
              }
            : undefined
        }
        // createProject's response renders the route, so no refresh follows.
        onSuccess={async (payload) => {
          setOpen(false);
          await onProjectCreated?.(payload);
        }}
      />
    </TabsContent>
  );
}

export function CreateAuftragProjectDialog({
  members,
  jobs,
  defaultClient,
  defaultEmployeeIds,
  readOnlyClient,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onJobCreated,
  onProjectCreated,
  onJobSubmit,
  onProjectSubmit,
}: CreateAuftragProjectDialogProps) {
  const {
    activeTab,
    setActiveTab,
    isCreatingJob,
    setIsCreatingJob,
    isCreatingProject,
    setIsCreatingProject,
    isControlled,
    open,
    setOpen,
  } = useCreateAuftragProjectDialogState(controlledOpen, controlledOnOpenChange);

  return (
    <Dialog open={open} onOpenChange={setOpen} pending={isCreatingJob || isCreatingProject}>
      {!isControlled && <CreateAuftragProjectTrigger />}
      <DialogContent workspace>
        <DialogHeader>
          <DialogTitle>Neuen Auftrag oder Projekt erstellen</DialogTitle>
          <DialogDescription>
            Erstelle einen neuen Auftrag oder ein neues Projekt für deine Organisation.
          </DialogDescription>
        </DialogHeader>

        {/* A tab change unmounts the saving form and would release the dialog mid-request. */}
        <Tabs
          value={activeTab}
          onValueChange={(nextTab) => {
            if (!isCreatingJob && !isCreatingProject) setActiveTab(nextTab);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <CreateAuftragProjectTabsList />

          <CreateAuftragJobTab
            members={members}
            defaultClient={defaultClient}
            defaultEmployeeIds={defaultEmployeeIds}
            readOnlyClient={readOnlyClient}
            isActive={activeTab === 'job'}
            onPendingChange={setIsCreatingJob}
            setOpen={setOpen}
            onJobSubmit={onJobSubmit}
            onJobCreated={onJobCreated}
          />

          <CreateAuftragProjectTab
            jobs={jobs}
            defaultClient={defaultClient}
            readOnlyClient={readOnlyClient}
            isActive={activeTab === 'project'}
            onPendingChange={setIsCreatingProject}
            setOpen={setOpen}
            onProjectSubmit={onProjectSubmit}
            onProjectCreated={onProjectCreated}
          />
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
