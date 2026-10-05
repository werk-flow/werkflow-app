'use client';

import { useState, type FormEvent } from 'react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import { useServerAction } from '@/hooks/use-server-action';
import { loadDocument } from '@/lib/navigation/document-load';
import { downloadPayrollExport, generatePayrollExport } from '@/lib/time-accounts/actions';
import { getTimeAccountFailureMessage } from '@/lib/time-accounts/messages';

/** Builds the payroll ZIP of a closed period; the refusal stays beside the button. */
export function TimePeriodExportForm({ periodId }: { periodId: string }) {
  const { showBanner } = useBanner();
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useServerAction(generatePayrollExport);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const formData = new FormData();
    formData.set('periodId', periodId);
    try {
      const result = await run(formData);
      if (!result.success) {
        setError(getTimeAccountFailureMessage('generateExport', result.error));
        return;
      }
      showBanner({ variant: 'success', message: 'Der Lohnexport ist bereit.' });
    } catch {
      setError(getTimeAccountFailureMessage('generateExport', 'export_failed'));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Button type="submit" disabled={isPending} aria-busy={isPending || undefined}>
        <InlinePending active={isPending} label="Lohnexport wird erzeugt" />
        Deterministisches ZIP erzeugen
      </Button>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

/** Downloads one ready export through a signed URL; the refusal stays beside the button. */
export function TimePeriodExportDownload({ exportId }: { exportId: string }) {
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useServerAction(downloadPayrollExport);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const formData = new FormData();
    formData.set('exportId', exportId);
    try {
      const result = await run(formData);
      if (!result.success) {
        setError(getTimeAccountFailureMessage('downloadExport', result.error));
        return;
      }
      loadDocument(result.url);
    } catch {
      setError(getTimeAccountFailureMessage('downloadExport', 'download_failed'));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col items-end gap-1">
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={isPending}
        aria-busy={isPending || undefined}
      >
        <InlinePending active={isPending} label="Download wird vorbereitet" />
        ZIP herunterladen
      </Button>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
