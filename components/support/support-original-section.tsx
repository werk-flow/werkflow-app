'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import { useRouterRefresh } from '@/components/ui/refresh-button';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useServerAction } from '@/hooks/use-server-action';
import { formatFileSize } from '@/lib/documents/format';
import { logError } from '@/lib/logging';
import {
  openProblemReportAttachment,
  openProblemReportOriginal,
} from '@/lib/problem-reports/support-actions';
import { supportFailureMessage } from '@/lib/problem-reports/support-messages';
import type { ProblemReportOriginal, SupportReport } from '@/lib/problem-reports/types';

import { ReportContext } from './report-context';

// The original evidence of one report. Nothing of it is on the page until
// support presses „Original öffnen“; the server writes each opening into the
// report's history before it answers.

const ORIGINALS_DELETED = 'Das Original ist nach seiner Frist gelöscht.';

/** What „Original öffnen“ will show, by the number of attachments. */
function originalSummary(attachmentCount: number): string {
  const base = 'Das Original zeigt den unveränderten Text und wer gemeldet hat';
  if (attachmentCount === 0) return `${base}.`;
  return attachmentCount === 1 ? `${base}, dazu einen Anhang.` : `${base}, dazu ${attachmentCount} Anhänge.`;
}

function OriginalAttachments({
  reportId,
  attachments,
  onOpened,
}: {
  reportId: string;
  attachments: ProblemReportOriginal['attachments'];
  onOpened: () => void;
}) {
  const busy = useBusyIds();
  const [error, setError] = useState<string | null>(null);
  if (attachments.length === 0)
    return (
      <EmptyState size="compact" title="Keine Anhänge gesendet." description="Die Meldung kam ohne Datei." />
    );

  const open = (fileId: string): void => {
    setError(null);
    void busy.run(fileId, async () => {
      try {
        const result = await openProblemReportAttachment({ reportId, fileId });
        if (!result.success) {
          setError(supportFailureMessage(result.error));
          return;
        }
        onOpened();
        // The address downloads the file; the page stays.
        window.location.assign(result.url);
      } catch (thrown) {
        logError('OriginalAttachments: opening failed', thrown);
        setError(supportFailureMessage('request_failed'));
      }
    });
  };
  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-lg border">
        {attachments.map((file) => (
          <li key={file.id} className="flex flex-wrap items-center gap-2 py-1.5 pr-2 pl-3 text-sm">
            <span className="min-w-0 flex-1 break-words">
              {file.fileName}{' '}
              <span className="text-muted-foreground">({formatFileSize(file.sizeBytes)})</span>
            </span>
            <InlinePending active={busy.isBusy(file.id)} label="Anhang wird geöffnet" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy.isBusy(file.id)}
              aria-label={`„${file.fileName}“ herunterladen`}
              onClick={() => open(file.id)}
            >
              <Download />
              Herunterladen
            </Button>
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

export function SupportOriginalSection({ report }: { report: SupportReport }) {
  const { refresh } = useRouterRefresh();
  const { run, isPending } = useServerAction(openProblemReportOriginal);
  const [opened, setOpened] = useState<{ original: ProblemReportOriginal | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (report.originalsDeleted || (opened && opened.original === null))
    return (
      <p className="text-sm text-muted-foreground">
        {ORIGINALS_DELETED}{' '}
        {report.scrubbedDescription === null
          ? 'Es bleibt der Verlauf.'
          : 'Es bleiben die bereinigte Fassung und der Verlauf.'}
      </p>
    );

  const original = opened?.original;
  if (!original) {
    const open = async (): Promise<void> => {
      setError(null);
      try {
        const result = await run(report.id);
        if (!result.success) {
          setError(supportFailureMessage(result.error));
          return;
        }
        setOpened({ original: result.original });
        // The history gained this opening.
        refresh();
      } catch (thrown) {
        logError('SupportOriginalSection: opening failed', thrown);
        setError(supportFailureMessage('request_failed'));
      }
    };
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {originalSummary(report.attachmentCount)} Jedes Öffnen steht mit deinem Namen im Verlauf.
        </p>
        <ErrorText>{error}</ErrorText>
        <Button
          type="button"
          variant="outline"
          pending={isPending}
          disabled={isPending}
          onClick={() => void open()}
        >
          Original öffnen
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <span className="text-muted-foreground">Gemeldet von </span>
        <span className="font-medium">{original.reporterName}</span>
      </p>
      <p className="rounded-lg border bg-muted/40 p-3 text-sm break-words whitespace-pre-wrap">
        {original.description}
      </p>
      <ReportContext context={original.context} />
      <OriginalAttachments reportId={report.id} attachments={original.attachments} onOpened={refresh} />
    </div>
  );
}
