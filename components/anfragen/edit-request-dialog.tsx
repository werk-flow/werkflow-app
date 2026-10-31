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
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { ErrorText } from '@/components/ui/error-text';
import type { ClientRequest } from '@/lib/requests/types';
import { EditRequestCallerFields } from './edit-request-caller-fields';
import { RequestTriageFields } from './request-triage-fields';
import { EditRequestRoutingFields } from './edit-request-routing-fields';
import { useEditRequestForm } from './use-edit-request-form';

interface EditRequestDialogProps {
  request: ClientRequest;
  assignees: Array<{ userId: string; name: string }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires after the server confirmed; the page marks itself until refreshed props land. */
  onSaved?: () => void;
}

export function EditRequestDialog({
  request,
  assignees,
  open,
  onOpenChange,
  onSaved,
}: EditRequestDialogProps) {
  const form = useEditRequestForm({ request, open, onOpenChange, onSaved });
  const { summary, setSummary, details, setDetails, isLoading, summaryError, formError, handleSubmit } = form;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isLoading}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Anfrage bearbeiten</DialogTitle>
          <DialogDescription>Änderungen werden im Verlauf der Anfrage festgehalten.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-2">
            <Field label="Anliegen" htmlFor="edit-request-summary" required error={summaryError}>
              <Input value={summary} onChange={(e) => setSummary(e.target.value)} disabled={isLoading} />
            </Field>

            <RequestTriageFields idPrefix="edit-request" form={form} />

            <Field label="Details" htmlFor="edit-request-details">
              <Textarea value={details} onChange={(e) => setDetails(e.target.value)} disabled={isLoading} />
            </Field>

            {!request.clientId && <EditRequestCallerFields form={form} />}

            <EditRequestRoutingFields assignees={assignees} form={form} />

            <ErrorText>{formError}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              Abbrechen
            </Button>
            <Button pending={isLoading} type="submit" disabled={isLoading}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
