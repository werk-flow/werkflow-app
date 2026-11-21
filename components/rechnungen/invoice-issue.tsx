'use client';

import { FileCheck2, FileText, Stamp } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { SectionError } from '@/components/ui/section-error';
import { TextLink } from '@/components/ui/text-link';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { fileInvoiceOriginal, issueInvoice } from '@/lib/invoices/issue-actions';
import type { IssueFinding } from '@/lib/invoices/issue-model';
import type { InvoiceDetail } from '@/lib/invoices/types';
import { formatGermanDate } from '@/lib/utils';
import { INVOICE_FAILURE_MESSAGES } from './invoice-failure-messages';

const ISSUE_FAILED = INVOICE_FAILURE_MESSAGES.issue_failed ?? '';
const ORIGINAL_FAILED = INVOICE_FAILURE_MESSAGES.original_failed ?? '';

/**
 * „Ausstellen“: after the confirmation the server checks the saved draft
 * with the EN 16931 rules, gives it the next number and files its original.
 * A draft that fails the check stays a draft; `onFindings` shows why.
 */
export function IssueInvoiceButton({
  invoice,
  unsaved,
  onFindings,
}: {
  invoice: Pick<InvoiceDetail, 'id' | 'version'>;
  /** The editor holds changes the draft does not have yet. */
  unsaved: boolean;
  onFindings: (findings: IssueFinding[]) => void;
}) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [attemptKey] = useState(() => crypto.randomUUID());
  const { run } = useServerAction(issueInvoice);
  return (
    <ConfirmActionDialog
      trigger={
        <Button type="button" variant="outline">
          <Stamp className="size-4" />
          Ausstellen
        </Button>
      }
      title="Rechnung ausstellen?"
      description={
        unsaved
          ? 'Du hast Änderungen, die noch nicht gespeichert sind. Speichere sie zuerst, damit die Rechnung sie enthält.'
          : 'Die Rechnung erhält die nächste Rechnungsnummer und das heutige Rechnungsdatum. Danach lässt sie sich weder ändern noch löschen; ihr Original wird zehn Jahre aufbewahrt.'
      }
      confirmLabel="Jetzt ausstellen"
      onConfirm={async () => {
        if (unsaved) return 'Speichere zuerst deine Änderungen.';
        onFindings([]);
        const result = await run({
          invoiceId: invoice.id,
          expectedVersion: invoice.version,
          attemptKey,
        }).catch(() => null);
        if (!result) return ISSUE_FAILED;
        if (!result.success) {
          if ('findings' in result) {
            onFindings(result.findings);
            return null;
          }
          return describeFailure(result.error, INVOICE_FAILURE_MESSAGES, ISSUE_FAILED);
        }
        showBanner({
          variant: result.originalFiled ? 'success' : 'info',
          message: result.originalFiled
            ? `Rechnung ${result.invoiceNumber} ist ausgestellt und abgelegt.`
            : `Rechnung ${result.invoiceNumber} ist ausgestellt. Der Beleg ist noch nicht abgelegt.`,
        });
        router.refresh();
        return null;
      }}
    />
  );
}

/** What keeps the draft from being issued, each with where to fix it. */
export function IssueFindings({ findings }: { findings: readonly IssueFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <SectionError title="Die Rechnung besteht die Prüfung nicht und bleibt ein Entwurf. Ergänze:">
      <ul className="list-disc space-y-1 pl-5">
        {findings.map((finding) => (
          <li key={finding.label}>
            {finding.href ? <TextLink href={finding.href}>{finding.label}</TextLink> : finding.label}
          </li>
        ))}
      </ul>
    </SectionError>
  );
}

/** „Vorschau“ of the saved draft as a PDF, without number and without e-invoice data. */
export function InvoicePreviewLink({ invoiceId }: { invoiceId: string }) {
  return (
    <Button asChild variant="outline">
      <a href={`/api/rechnungen/vorschau?rechnung=${invoiceId}`} target="_blank" rel="noopener">
        <FileText className="size-4" />
        Vorschau
      </a>
    </Button>
  );
}

/** An issued invoice's date and its filed original, or „Beleg ausstehend“ with a retry. */
export function IssuedInvoiceOriginal({ invoice }: { invoice: InvoiceDetail }) {
  const router = useRouter();
  const { run, isPending } = useServerAction(fileInvoiceOriginal);
  const [error, setError] = useState<string | null>(null);
  const issuedOn = invoice.issueDate ? formatGermanDate(invoice.issueDate) : '';
  if (invoice.original?.filed) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4 text-sm shadow-xs">
        <FileCheck2 className="size-5 text-success-text" aria-hidden />
        <p className="min-w-0 flex-1">
          Ausgestellt am {issuedOn}. Das Original ist abgelegt und wird zehn Jahre aufbewahrt.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href={`/dokumente?document=${invoice.original.documentId}`}>Original öffnen</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-warning bg-warning-soft p-4 text-sm text-warning-soft-foreground">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1">
          <span className="font-medium">Beleg ausstehend.</span> Die Rechnung ist am {issuedOn} ausgestellt,
          ihr Original ist aber noch nicht abgelegt. Erstelle es jetzt; Nummer und Inhalt bleiben gleich.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          pending={isPending}
          onClick={async () => {
            setError(null);
            const result = await run({ invoiceId: invoice.id }).catch(() => null);
            if (result?.success) router.refresh();
            else
              setError(
                result
                  ? describeFailure(result.error, INVOICE_FAILURE_MESSAGES, ORIGINAL_FAILED)
                  : ORIGINAL_FAILED,
              );
          }}
        >
          Beleg erstellen
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
