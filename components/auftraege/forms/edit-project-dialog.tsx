'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { type Client, type Job, type Project, type ProjectWithDetails } from '@/lib/jobs/types';
import { EditProjectFormFields } from './edit-project-form-fields';
import { useEditProjectForm } from './use-edit-project-form';
import { useEditProjectSubmit } from './use-edit-project-submit';

interface EditProjectDialogProps {
  project: ProjectWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  jobs: Job[];
  onSuccess?: ((payload: { project: Project; selectedJobIds: string[] }) => void | Promise<void>) | undefined;
}

export function EditProjectDialog({
  project,
  open,
  onOpenChange,
  clients,
  jobs,
  onSuccess,
}: EditProjectDialogProps) {
  const form = useEditProjectForm({ project, open, jobs });
  const { handleSubmit } = useEditProjectSubmit({
    project,
    form,
    onOpenChange,
    onSuccess,
  });
  const { isLoading, error, formDisabled } = form;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isLoading}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Projekt bearbeiten</DialogTitle>
          <DialogDescription>Ändere die Daten des Projekts.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-2">
            <EditProjectFormFields form={form} clients={clients} />

            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button pending={isLoading} type="submit" disabled={formDisabled}>
              {isLoading ? 'Wird gespeichert…' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
