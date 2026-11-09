'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useBanner } from '@/components/ui/banner';
import { usePendingTask } from '@/hooks/use-server-action';
import { logError } from '@/lib/logging';
import { submitProblemReport } from '@/lib/problem-reports/actions';
import { buildProblemReportContext } from '@/lib/problem-reports/capture/context';
import { problemReportFailureMessage } from '@/lib/problem-reports/messages';
import { burnRedactions, type RedactionBox } from '@/lib/problem-reports/redaction';
import { loadUiStringCatalog } from '@/lib/problem-reports/screenshot/load-ui-string-catalog';
import { uploadProblemReportFile, type ProblemReportFile } from '@/lib/problem-reports/upload-client';
import type { ProblemReportCapture } from './problem-report-launcher';

// Sending a report is two steps: the report, then its files. A file that
// fails keeps the saved report; the next send sends only what is missing.

/** One attachment the person chose, with a key that stays when others leave. */
export type ChosenAttachment = { key: number; file: File };

/** What the person filled in, as the send needs it. */
export type ProblemReportDraft = {
  description: string;
  includeScreenshot: boolean;
  boxes: readonly RedactionBox[];
  attachments: readonly ChosenAttachment[];
};

type SavedReport = { reportId: string; number: number };
type KeyedFile = { key: string; file: ProblemReportFile };

/** The screenshot with its boxes burned in, then the attachments, each with its retry key. */
async function filesOf(
  draft: ProblemReportDraft,
  screenshot: Promise<ImageBitmap | null>,
): Promise<KeyedFile[]> {
  const attachments: KeyedFile[] = draft.attachments.map(({ key, file }) => ({
    key: `anhang-${key}`,
    file: { kind: 'anhang', bytes: file, fileName: file.name },
  }));
  const image = draft.includeScreenshot ? await screenshot : null;
  if (!image) return attachments;
  const bytes = await burnRedactions(image, draft.boxes);
  return [
    { key: 'screenshot', file: { kind: 'screenshot', bytes, fileName: 'screenshot.png' } },
    ...attachments,
  ];
}

export function useProblemReportSend(capture: ProblemReportCapture, close: () => void) {
  const { showBanner } = useBanner();
  const router = useRouter();
  const pathname = usePathname();
  const { run, isPending } = usePendingTask();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedReport | null>(null);
  // Chosen once per dialog: a retry after a lost answer saves the same report.
  const [reportId] = useState(() => crypto.randomUUID());
  // The files that reached the saved report, so a retry sends only the rest,
  // and the stored bytes of each file whose registration has not answered yet.
  const [sentFiles, setSentFiles] = useState<ReadonlySet<string>>(new Set());
  const [storedFiles, setStoredFiles] = useState<ReadonlyMap<string, string>>(new Map());

  const saveReport = async (organizationId: string, description: string): Promise<SavedReport | null> => {
    if (saved) return saved;
    const result = await submitProblemReport({
      organizationId,
      reportId,
      description,
      context: buildProblemReportContext(capture.activity, loadUiStringCatalog(), capture.device),
    });
    if (!result.success) {
      setError(problemReportFailureMessage(result.error));
      return null;
    }
    const report = { reportId: result.reportId, number: result.number };
    setSaved(report);
    return report;
  };

  const sendFiles = async (
    organizationId: string,
    report: SavedReport,
    files: KeyedFile[],
  ): Promise<boolean> => {
    const sent = new Set(sentFiles);
    const stored = new Map(storedFiles);
    for (const { key, file } of files) {
      if (sent.has(key)) continue;
      const target = { organizationId, reportId: report.reportId };
      const { result, storedFileId } = await uploadProblemReportFile(target, file, stored.get(key) ?? null);
      if (storedFileId) stored.set(key, storedFileId);
      else stored.delete(key);
      setStoredFiles(new Map(stored));
      if (!result.success) {
        const what = file.kind === 'screenshot' ? 'der Screenshot' : `„${file.fileName}“`;
        const reason = problemReportFailureMessage(result.error);
        setError(`Deine Meldung Nr. ${report.number} ist gespeichert, aber ${what} fehlt noch. ${reason}`);
        return false;
      }
      sent.add(key);
      setSentFiles(new Set(sent));
    }
    return true;
  };

  const send = (organizationId: string, draft: ProblemReportDraft): void => {
    void run(async () => {
      setError(null);
      try {
        const report = await saveReport(organizationId, draft.description.trim());
        if (!report) return;
        if (!(await sendFiles(organizationId, report, await filesOf(draft, capture.screenshot)))) return;
        confirm(report);
      } catch (thrown) {
        // A lost connection or a device that cannot encode the image: the
        // dialog stays open with what is saved, and „Senden“ tries again.
        logError('useProblemReportSend: send failed', thrown);
        setError(problemReportFailureMessage('send_interrupted'));
      }
    });
  };

  const confirm = (report: SavedReport): void => {
    close();
    showBanner({
      variant: 'success',
      message: `Danke! Deine Meldung Nr. ${report.number} ist eingegangen.`,
      actionLabel: 'Meine Meldungen',
      onAction: () => router.push('/meldungen'),
    });
    // The list reads per request; only an open list needs a new read.
    if (pathname === '/meldungen') router.refresh();
  };

  // A file whose bytes left the device no longer changes: a retry sends those bytes.
  const frozenFiles: ReadonlySet<string> = new Set([...sentFiles, ...storedFiles.keys()]);
  return { send, isPending, error, setError, saved: saved !== null, frozenFiles };
}
