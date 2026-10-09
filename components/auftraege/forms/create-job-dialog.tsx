'use client';

import { useState } from 'react';
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
import { CreateJobFormContent } from './create-job-form-content';
import type { Job } from '@/lib/jobs/types';
import type { JobEntityOption } from '@/lib/jobs/option-types';
import type { ClientSelectItem } from '../shared/client-select-with-create';

interface CreateJobDialogProps {
  members: OrgMemberOption[];
  defaultProject?: JobEntityOption | undefined;
  defaultClient?: ClientSelectItem | undefined;
  defaultEmployeeIds?: string[] | undefined;
  readOnlyClient?: boolean | undefined;
  readOnlyProject?: boolean | undefined;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  onJobCreated?: (payload: { job: Job; assignedUserIds: string[] }) => void | Promise<void>;
}

export function CreateJobDialog({
  members,
  defaultProject,
  defaultClient,
  defaultEmployeeIds,
  readOnlyClient,
  readOnlyProject,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onJobCreated,
}: CreateJobDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (v: boolean) => controlledOnOpenChange?.(v) : setInternalOpen;
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
        <CreateJobFormContent
          members={members}
          defaultProject={defaultProject}
          defaultClient={defaultClient}
          defaultEmployeeIds={defaultEmployeeIds}
          readOnlyClient={readOnlyClient}
          readOnlyProject={readOnlyProject}
          onPendingChange={setIsCreating}
          // createJob's response renders the route, so no refresh follows.
          onSuccess={async (payload) => {
            setOpen(false);
            await onJobCreated?.(payload);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
