'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  ClientSelectWithCreate,
  type ClientSelectItem,
} from '@/components/auftraege/shared/client-select-with-create';
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
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { untilPageLeaves, usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { createInvoice } from '@/lib/invoices/actions';
import {
  INVOICE_WORK_KINDS,
  INVOICE_WORK_LABELS,
  invoiceWorkKindSchema,
  type InvoiceWorkKind,
} from '@/lib/invoices/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { INVOICE_FAILURE_MESSAGES } from './invoice-failure-messages';

const CLIENT_FIELD = 'invoice-client';
const WORK_KIND_FIELD = 'invoice-work-kind';
const WORK_FIELD = 'invoice-work';
const NO_WORK = 'keine';
const SAVE_FAILED = 'Die Rechnung konnte nicht angelegt werden. Bitte versuche es erneut.';

const OPTION_KIND: Record<InvoiceWorkKind, 'jobs' | 'projects' | 'service-cases'> = {
  job: 'jobs',
  project: 'projects',
  service_case: 'service-cases',
};

type Form = { client: ClientSelectItem | null; workKind: InvoiceWorkKind | null; workId: string };

function formErrors(form: Form): Record<string, string | undefined> {
  return {
    [CLIENT_FIELD]: form.client ? undefined : 'Wähle den Kunden.',
    [WORK_FIELD]:
      form.workKind && !form.workId ? 'Wähle aus, wofür die Rechnung ist, oder „Ohne Bezug“.' : undefined,
  };
}

/**
 * „Rechnung erstellen“: the customer, optionally one of its jobs, projects or
 * Servicefälle. The draft opens on its own page, where lines and terms are
 * filled in. A press repeated after a lost answer sends the same key and
 * opens the first draft.
 */
export function CreateInvoiceDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  // A changed form gets a new key: only a repeat of the same press answers with the first draft.
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const [form, setFormState] = useState<Form>({ client: null, workKind: null, workId: '' });
  const setForm = (next: Form) => {
    setFormState(next);
    setAttemptKey(crypto.randomUUID());
  };
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending: pending } = usePendingTask();
  const errors = formErrors(form);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField(errors) || !form.client) return;
    const clientId = form.client.id;
    const work = form.workKind && form.workId ? { kind: form.workKind, id: form.workId } : null;
    void run(async () => {
      setError(null);
      const result = await createInvoice({ attemptKey, clientId, work }).catch(() => null);
      if (!result?.success) {
        setError(result ? describeFailure(result.error, INVOICE_FAILURE_MESSAGES, SAVE_FAILED) : SAVE_FAILED);
        return;
      }
      router.push(`/rechnungen/${result.invoiceId}`);
      return untilPageLeaves();
    });
  };

  const shownErrors = attempted ? errors : {};
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={pending}>
      <DialogContent size="lg">
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Rechnung erstellen</DialogTitle>
            <DialogDescription>
              Die Rechnung startet als Entwurf. Den Rechnungsempfänger übernimmt sie aus dem gewählten
              Auftrag, Projekt oder Servicefall, sonst ist es der Kunde.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Kunde" htmlFor={CLIENT_FIELD} required error={shownErrors[CLIENT_FIELD]}>
              <ClientSelectWithCreate
                id={CLIENT_FIELD}
                value={form.client?.id ?? ''}
                selectedClient={form.client}
                onValueChange={(_value, client) =>
                  setForm({
                    client,
                    workKind: form.workKind,
                    workId: client?.id === form.client?.id ? form.workId : '',
                  })
                }
                disabled={pending}
              />
            </Field>
            <WorkFields form={form} onChange={setForm} error={shownErrors[WORK_FIELD]} disabled={pending} />
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Abbrechen
            </Button>
            <Button type="submit" pending={pending}>
              Rechnung erstellen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** „Abrechnen für“: none, or one job, project or Servicefall of the chosen customer. */
function WorkFields({
  form,
  onChange,
  error,
  disabled,
}: {
  form: Form;
  onChange: (form: Form) => void;
  error: string | undefined;
  disabled: boolean;
}) {
  const clientId = form.client?.id;
  const workSearch = useJobEntityOptions(
    { kind: OPTION_KIND[form.workKind ?? 'job'], purpose: 'invoice-work', ...(clientId ? { clientId } : {}) },
    form.workId ? [form.workId] : [],
  );
  // The project reader also offers projects without a customer, which no invoice of this customer bills.
  const workOptions = workSearch.options.filter((option) => option.clientId === clientId);
  return (
    <>
      <Field label="Abrechnen für" htmlFor={WORK_KIND_FIELD}>
        <Select
          value={form.workKind ?? NO_WORK}
          onValueChange={(value) =>
            onChange({ ...form, workKind: invoiceWorkKindSchema.safeParse(value).data ?? null, workId: '' })
          }
          disabled={disabled || !form.client}
        >
          <SelectTrigger id={WORK_KIND_FIELD} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_WORK}>Ohne Bezug</SelectItem>
            {INVOICE_WORK_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {INVOICE_WORK_LABELS[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {form.workKind && (
        <Field label={INVOICE_WORK_LABELS[form.workKind]} htmlFor={WORK_FIELD} required error={error}>
          <SearchableSelect
            id={WORK_FIELD}
            value={form.workId}
            onChange={(workId) => onChange({ ...form, workId })}
            options={workOptions}
            onSearchChange={workSearch.onSearchChange}
            loading={workSearch.loading}
            loadFailure={workSearch.loadFailure}
            onLoadMore={workSearch.onLoadMore}
            disabled={disabled}
            placeholder={`${INVOICE_WORK_LABELS[form.workKind]} wählen`}
            searchPlaceholder="Suchen…"
            emptyMessage="Nichts gefunden"
          />
        </Field>
      )}
    </>
  );
}
