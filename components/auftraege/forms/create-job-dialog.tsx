'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { OptionsLoadError } from '../shared/options-load-error';
import { CreateJobFormContent } from './create-job-form-content';
import type { Client, Job, ProjectWithDetails } from '@/lib/jobs/types';

interface CreateJobDialogProps {
  clients: Client[];
  members: OrgMemberOption[];
  projects?: ProjectWithDetails[] | undefined;
  defaultProjectId?: string | undefined;
  defaultClientId?: string | undefined;
  defaultEmployeeIds?: string[] | undefined;
  readOnlyClient?: boolean | undefined;
  readOnlyProject?: boolean | undefined;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  onJobCreated?: (payload: { job: Job; assignedUserIds: string[] }) => void | Promise<void>;
  /** The client and member options load after open; a failed load shows here with a retry. */
  optionsLoad?: { error: string | null; retry: () => void; isLoading: boolean } | undefined;
}

export function CreateJobDialog({
  clients,
  members,
  projects = [],
  defaultProjectId,
  defaultClientId,
  defaultEmployeeIds,
  readOnlyClient,
  readOnlyProject,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onJobCreated,
  optionsLoad,
}: CreateJobDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (v: boolean) => controlledOnOpenChange?.(v) : setInternalOpen;
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen} pending={isCreating}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button size="default" className="gap-2">
            <Plus className="size-4" />
            <span className="sr-only sm:not-sr-only">Auftrag erstellen</span>
            <span className="sm:hidden" aria-hidden="true">
              Erstellen
            </span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Neuen Auftrag erstellen</DialogTitle>
          <DialogDescription>Erstelle einen neuen Auftrag für deine Organisation.</DialogDescription>
        </DialogHeader>
        {optionsLoad && (
          <OptionsLoadError
            error={optionsLoad.error}
            onRetry={optionsLoad.retry}
            retrying={optionsLoad.isLoading}
          />
        )}
        <CreateJobFormContent
          clients={clients}
          members={members}
          projects={projects}
          defaultProjectId={defaultProjectId}
          defaultClientId={defaultClientId}
          defaultEmployeeIds={defaultEmployeeIds}
          readOnlyClient={readOnlyClient}
          readOnlyProject={readOnlyProject}
          onPendingChange={setIsCreating}
          onSuccess={async (payload) => {
            setOpen(false);
            if (onJobCreated) {
              await onJobCreated(payload);
              return;
            }
            router.refresh();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
