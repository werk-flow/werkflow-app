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
import { CreateProjectFormContent } from './create-project-form-content';
import { type Client, type Job } from '@/lib/jobs/types';

interface CreateProjectDialogProps {
  clients: Client[];
  jobs: Job[];
  defaultClientId?: string;
  readOnlyClient?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateProjectDialog({ clients, jobs, defaultClientId, readOnlyClient, open: controlledOpen, onOpenChange: controlledOnOpenChange }: CreateProjectDialogProps) {
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
            <span className="hidden sm:inline">Projekt erstellen</span>
            <span className="sm:hidden">Erstellen</span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-[500px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Neues Projekt erstellen</DialogTitle>
          <DialogDescription>
            Erstelle ein neues Projekt für deine Organisation.
          </DialogDescription>
        </DialogHeader>
        <CreateProjectFormContent
          clients={clients}
          jobs={jobs}
          defaultClientId={defaultClientId}
          readOnlyClient={readOnlyClient}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
