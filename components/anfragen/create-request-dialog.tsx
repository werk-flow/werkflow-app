'use client';

import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/error-text';
import { CreateRequestCustomerFields } from './create-request-customer-fields';
import { CreateRequestFurtherFields } from './create-request-further-fields';
import { RequestTriageFields } from './request-triage-fields';
import { useCreateRequestForm } from './use-create-request-form';

type RequestAssigneeOption = {
  userId: string;
  name: string;
};

interface CreateRequestDialogProps {
  assignees: RequestAssigneeOption[];
}

export function CreateRequestDialog({ assignees }: CreateRequestDialogProps) {
  const form = useCreateRequestForm();
  const { open, handleOpenChange, summary, setSummary, isLoading, summaryError, formError, handleSubmit } =
    form;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} pending={isLoading}>
      <DialogTrigger asChild>
        <Button size="default" className="gap-2">
          <Plus className="size-4" />
          <span className="sr-only sm:not-sr-only">Anfrage erfassen</span>
          <span className="sm:hidden" aria-hidden="true">
            Erfassen
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neue Anfrage erfassen</DialogTitle>
          <DialogDescription>
            Halte das Anliegen direkt während des Gesprächs fest. Nur die Beschreibung ist Pflicht – alles
            andere kannst du später ergänzen.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.stopPropagation();
            // handleSubmit reports its own failures in the dialog.
            void handleSubmit(e);
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody className="grid gap-4 py-2">
            <Field label="Anliegen" htmlFor="request-summary" required error={summaryError}>
              <Input
                placeholder="z. B. Heizung fällt aus, kein Warmwasser"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                disabled={isLoading}
              />
            </Field>

            <RequestTriageFields idPrefix="request" form={form} />

            <CreateRequestCustomerFields form={form} />

            <CreateRequestFurtherFields assignees={assignees} form={form} />

            <ErrorText>{formError}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button pending={isLoading} type="submit" disabled={isLoading}>
              {isLoading ? 'Wird gespeichert…' : 'Anfrage erfassen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
