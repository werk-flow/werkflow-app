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
  DialogTrigger
} from '@/components/ui/dialog';
import type { OrgMemberOption } from './employee-multi-select';
import { CreateJobFormContent } from './create-job-form-content';
import type { Client, ProjectWithDetails } from '@/lib/jobs/types';

interface CreateJobDialogProps {
  clients: Client[];
  members: OrgMemberOption[];
  projects?: ProjectWithDetails[];
  defaultProjectId?: string;
  defaultClientId?: string;
  defaultEmployeeIds?: string[];
  readOnlyClient?: boolean;
  readOnlyProject?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateJobDialog({ clients, members, projects = [], defaultProjectId, defaultClientId, defaultEmployeeIds, readOnlyClient, readOnlyProject, open: controlledOpen, onOpenChange: controlledOnOpenChange }: CreateJobDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (v: boolean) => controlledOnOpenChange?.(v) : setInternalOpen;
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button size="default" className="gap-2">
            <Plus className="size-4" />
            <span className="hidden sm:inline">Auftrag erstellen</span>
            <span className="sm:hidden">Erstellen</span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-[500px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Neuen Auftrag erstellen</DialogTitle>
          <DialogDescription>
            Erstelle einen neuen Auftrag für deine Organisation.
          </DialogDescription>
        </DialogHeader>
        <CreateJobFormContent
          clients={clients}
          members={members}
          projects={projects}
          defaultProjectId={defaultProjectId}
          defaultClientId={defaultClientId}
          defaultEmployeeIds={defaultEmployeeIds}
          readOnlyClient={readOnlyClient}
          readOnlyProject={readOnlyProject}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
