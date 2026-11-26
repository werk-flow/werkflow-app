'use client';

import { Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useBanner } from '@/components/ui/banner';
import { ErrorText } from '@/components/ui/error-text';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { saveInvoiceDraft } from '@/lib/invoices/actions';
import { draftAmounts, type DraftAmounts } from '@/lib/invoices/amounts';
import {
  draftFormOf,
  emptyLine,
  parseDraftForm,
  parseDraftLines,
  type DraftForm,
} from '@/lib/invoices/draft-form';
import type { IssueFinding } from '@/lib/invoices/issue-model';
import type { InvoiceDetail, InvoiceWorkKind } from '@/lib/invoices/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { InvoiceCatalogLine } from './invoice-catalog-line';
import { INVOICE_FAILURE_MESSAGES } from './invoice-failure-messages';
import { InvoicePreviewLink, IssueFindings, IssueInvoiceButton } from './invoice-issue';
import { InvoiceLinesFields } from './invoice-lines-fields';
import { InvoiceTermsFields, InvoiceTextFields } from './invoice-terms-fields';
import { InvoiceTotals } from './invoice-totals';

const WORK_TABLES = {
  job: 'jobs',
  project: 'projects',
  service_case: 'service_cases',
} as const satisfies Record<InvoiceWorkKind, string>;

const SAVE_FAILED = INVOICE_FAILURE_MESSAGES.save_failed ?? '';

/** The live amounts of the lines as typed; null while one cannot be read or the line rule refuses it. */
function liveAmounts(form: DraftForm): DraftAmounts | null {
  const lines = parseDraftLines(form.lines);
  if (!lines) return null;
  try {
    return draftAmounts(lines);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/**
 * The draft's lines and terms with their totals. The totals follow every
 * keystroke through the invoice core; „Speichern“ sends the whole draft, and
 * the server computes and stores the amounts again. Another session's save
 * shows here at once while nothing is typed; with own changes it asks for a
 * reload, and a save from the older version is refused. An issued invoice
 * shows the same fields, none of them editable. A change of status mounts a
 * new editor: an answer the draft's editor still waits for, such as a catalog
 * line, lands on nothing.
 */
export function InvoiceEditor({ invoice }: { invoice: InvoiceDetail }) {
  return <InvoiceEditorForm key={`${invoice.id}:${invoice.status}`} invoice={invoice} />;
}

function InvoiceEditorForm({ invoice }: { invoice: InvoiceDetail }) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const draft = useDraftState(invoice);
  const { form, setForm, baseVersion } = draft;
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the last „Ausstellen“ found at fault; the draft stays a draft.
  const [findings, setFindings] = useState<IssueFinding[]>([]);
  const { run, isPending } = usePendingTask();
  // An issued invoice shows its fields read only.
  const pending = isPending || invoice.status !== 'entwurf';

  const parsed = parseDraftForm(form);
  const errors = attempted && !parsed.ok ? parsed.errors : {};
  const amounts = liveAmounts(form);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!parsed.ok) {
      focusFirstInvalidField(parsed.errors);
      return;
    }
    const submittedRevision = draft.revision();
    void run(async () => {
      setError(null);
      const result = await saveInvoiceDraft({
        invoiceId: invoice.id,
        expectedVersion: baseVersion,
        attemptKey: draft.attemptKey,
        terms: parsed.terms,
        lines: parsed.lines,
      }).catch(() => null);
      if (!result?.success) {
        setError(result ? describeFailure(result.error, INVOICE_FAILURE_MESSAGES, SAVE_FAILED) : SAVE_FAILED);
        return;
      }
      draft.markSaved(result.version, submittedRevision);
      setAttempted(false);
      showBanner({ variant: 'success', message: 'Entwurf gespeichert.' });
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-8">
      <IssueFindings findings={findings} />
      {draft.newerElsewhere && (
        <StaleNotice
          onReload={() => {
            draft.reload();
            setError(null);
          }}
        />
      )}
      <EditorLines
        form={form}
        setForm={setForm}
        amounts={amounts}
        errors={errors}
        disabled={pending}
        issued={invoice.status !== 'entwurf'}
      />
      <InvoiceTotals amounts={amounts} />
      <InvoiceTermsFields form={form} onChange={setForm} errors={errors} disabled={pending} />
      <InvoiceTextFields form={form} onChange={setForm} disabled={pending} />
      {invoice.status === 'entwurf' && (
        <DraftActions
          invoice={{ id: invoice.id, version: draft.baseVersion }}
          unsaved={draft.dirty}
          error={error}
          saving={isPending}
          onFindings={setFindings}
        />
      )}
    </form>
  );
}

/** The lines with their amounts. A draft adds an empty or a catalog line; an issued invoice adds none. */
function EditorLines({
  form,
  setForm,
  amounts,
  errors,
  disabled,
  issued,
}: {
  form: DraftForm;
  setForm: (next: DraftForm | ((current: DraftForm) => DraftForm)) => void;
  amounts: DraftAmounts | null;
  errors: Record<string, string | undefined>;
  disabled: boolean;
  issued: boolean;
}) {
  const [nextKey, setNextKey] = useState(0);
  return (
    <>
      <InvoiceLinesFields
        lines={form.lines}
        lineNetCents={form.lines.map((_line, index) => amounts?.lineNetCents[index] ?? null)}
        onChange={(lines) => setForm({ ...form, lines })}
        onAdd={() => {
          setForm({ ...form, lines: [...form.lines, emptyLine(`new-${nextKey}`)] });
          setNextKey(nextKey + 1);
        }}
        errors={errors}
        disabled={disabled}
        issued={issued}
      />
      {!issued && (
        <InvoiceCatalogLine
          onAdd={(line) => setForm((current) => ({ ...current, lines: [...current.lines, line] }))}
          disabled={disabled}
        />
      )}
    </>
  );
}

/**
 * The editor's text and the version it is based on. Another session's newer
 * version replaces the text while nothing is typed; with own changes it waits
 * for „Neu laden“. Each change takes a new attempt key: only a repeat of the
 * same press answers with the first save.
 */
function useDraftState(invoice: InvoiceDetail) {
  // The facts show the customer's and recipient's names and the work's label, which other sessions change.
  useRealtimeRouterRefresh({
    tables: ['invoices', 'clients', ...(invoice.work ? [WORK_TABLES[invoice.work.kind]] : [])],
  });
  const [form, setFormState] = useState(() => draftFormOf(invoice));
  const [baseVersion, setBaseVersion] = useState(invoice.version);
  const [dirty, setDirty] = useState(false);
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  // Counts the changes, so a save marks saved only the text it sent: a catalog line that lands meanwhile stays unsaved.
  const revision = useRef(0);
  const newer = invoice.version > baseVersion;
  if (newer && !dirty) {
    setFormState(draftFormOf(invoice));
    setBaseVersion(invoice.version);
    setDirty(false);
  }
  return {
    form,
    baseVersion,
    attemptKey,
    dirty,
    newerElsewhere: newer && dirty,
    /** An update from an answer that arrives later takes the current text, so edits made meanwhile stay. */
    setForm: (next: DraftForm | ((current: DraftForm) => DraftForm)) => {
      revision.current += 1;
      setFormState(next);
      setDirty(true);
      setAttemptKey(crypto.randomUUID());
    },
    revision: () => revision.current,
    markSaved: (version: number, savedRevision: number) => {
      setBaseVersion(version);
      if (revision.current !== savedRevision) return;
      setDirty(false);
      setAttemptKey(crypto.randomUUID());
    },
    reload: () => {
      setFormState(draftFormOf(invoice));
      setBaseVersion(invoice.version);
      setDirty(false);
    },
  };
}

/** Preview, issue and save of a draft, under its fields. */
function DraftActions({
  invoice,
  unsaved,
  error,
  saving,
  onFindings,
}: {
  invoice: { id: string; version: number };
  unsaved: boolean;
  error: string | null;
  saving: boolean;
  onFindings: (findings: IssueFinding[]) => void;
}) {
  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
      <ErrorText>{error}</ErrorText>
      <InvoicePreviewLink invoiceId={invoice.id} />
      <IssueInvoiceButton invoice={invoice} unsaved={unsaved} onFindings={onFindings} />
      <Button type="submit" pending={saving}>
        <Save className="size-4" />
        Speichern
      </Button>
    </div>
  );
}

function StaleNotice({ onReload }: { onReload: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning bg-warning-soft p-3 text-sm text-warning-soft-foreground">
      <p className="min-w-0 flex-1">
        Jemand hat die Rechnung inzwischen geändert. Lade sie neu, deine Eingaben gehen dabei verloren.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onReload}>
        Neu laden
      </Button>
    </div>
  );
}
