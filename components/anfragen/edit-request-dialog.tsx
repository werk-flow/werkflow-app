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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateTimeField } from '@/components/ui/date-time-field';
import { ErrorText } from '@/components/ui/error-text';
import {
  REQUEST_CATEGORY_LABELS,
  REQUEST_CATEGORY_ORDER,
  REQUEST_URGENCY_LABELS,
  REQUEST_URGENCY_ORDER,
  type ClientRequest,
  type RequestCategory,
  type RequestUrgency,
} from '@/lib/requests/types';
import { EditRequestCallerFields } from './edit-request-caller-fields';
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
  const {
    summary,
    setSummary,
    details,
    setDetails,
    category,
    setCategory,
    urgency,
    setUrgency,
    receivedAt,
    setReceivedAt,
    isLoading,
    error,
    showSummaryError,
    showReceivedAtError,
    handleSubmit,
  } = form;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isLoading}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Anfrage bearbeiten</DialogTitle>
          <DialogDescription>Änderungen werden im Verlauf der Anfrage festgehalten.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-2">
            <Field
              label="Anliegen"
              htmlFor="edit-request-summary"
              required
              error={showSummaryError ? error : null}
            >
              <Input value={summary} onChange={(e) => setSummary(e.target.value)} disabled={isLoading} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Kategorie" htmlFor="edit-request-category">
                <Select
                  value={category}
                  onValueChange={(value) => setCategory(value as RequestCategory)}
                  disabled={isLoading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REQUEST_CATEGORY_ORDER.map((value) => (
                      <SelectItem key={value} value={value}>
                        {REQUEST_CATEGORY_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Dringlichkeit" htmlFor="edit-request-urgency">
                <Select
                  value={urgency}
                  onValueChange={(value) => setUrgency(value as RequestUrgency)}
                  disabled={isLoading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REQUEST_URGENCY_ORDER.map((value) => (
                      <SelectItem key={value} value={value}>
                        {REQUEST_URGENCY_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field
              label="Eingangszeit"
              htmlFor="edit-request-received-at-date"
              error={showReceivedAtError ? error : null}
            >
              <DateTimeField
                idPrefix="edit-request-received-at"
                value={receivedAt}
                onChange={setReceivedAt}
                disabled={isLoading}
                dateAriaLabel="Eingangsdatum"
                invalid={showReceivedAtError}
                describedById={showReceivedAtError ? 'edit-request-received-at-date-error' : undefined}
              />
            </Field>

            <Field label="Details" htmlFor="edit-request-details">
              <Textarea value={details} onChange={(e) => setDetails(e.target.value)} disabled={isLoading} />
            </Field>

            {!request.clientId && <EditRequestCallerFields form={form} />}

            <EditRequestRoutingFields assignees={assignees} form={form} />

            <ErrorText>{showSummaryError || showReceivedAtError ? null : error}</ErrorText>
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
