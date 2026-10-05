'use client';

import { Loader2, Plus } from 'lucide-react';

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateTimeField } from '@/components/ui/date-time-field';
import { ErrorText } from '@/components/ui/error-text';
import {
  REQUEST_CATEGORY_LABELS,
  REQUEST_CATEGORY_ORDER,
  REQUEST_URGENCY_LABELS,
  REQUEST_URGENCY_ORDER,
  type RequestCategory,
  type RequestUrgency,
} from '@/lib/requests/types';
import type { Client } from '@/lib/jobs/types';
import { CreateRequestCustomerFields } from './create-request-customer-fields';
import { CreateRequestFurtherFields } from './create-request-further-fields';
import { useCreateRequestForm } from './use-create-request-form';

type RequestAssigneeOption = {
  userId: string;
  name: string;
};

interface CreateRequestDialogProps {
  clients: Client[];
  assignees: RequestAssigneeOption[];
}

export function CreateRequestDialog({ clients, assignees }: CreateRequestDialogProps) {
  const form = useCreateRequestForm();
  const {
    open,
    handleOpenChange,
    summary,
    setSummary,
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
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
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
            handleSubmit(e);
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody className="grid gap-4 py-2">
            <Field
              label="Anliegen"
              htmlFor="request-summary"
              required
              error={showSummaryError ? 'Bitte beschreibe kurz das Anliegen.' : null}
            >
              <Input
                placeholder="z. B. Heizung fällt aus, kein Warmwasser"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                disabled={isLoading}
                autoFocus
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Kategorie" htmlFor="request-category">
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
              <Field label="Dringlichkeit" htmlFor="request-urgency">
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
              htmlFor="request-received-at-date"
              error={showReceivedAtError ? error : null}
            >
              <DateTimeField
                idPrefix="request-received-at"
                value={receivedAt}
                onChange={setReceivedAt}
                disabled={isLoading}
                dateAriaLabel="Eingangsdatum"
                invalid={showReceivedAtError}
                describedById={showReceivedAtError ? 'request-received-at-date-error' : undefined}
              />
            </Field>

            <CreateRequestCustomerFields clients={clients} form={form} />

            <CreateRequestFurtherFields assignees={assignees} form={form} />

            <ErrorText>{showReceivedAtError ? null : error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="size-4 animate-spin" />}
              {isLoading ? 'Wird gespeichert…' : 'Anfrage erfassen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
