'use client';

import { useState } from 'react';

import {
  uploadProblemReportFile,
  type ProblemReportFile,
  type ProblemReportFileActions,
} from '@/lib/problem-reports/upload-client';

/** One attachment the person chose, with a key that stays when others leave. */
export type ChosenAttachment = { key: number; file: File };
/** A file of a report with the key its retry state is kept under. */
export type KeyedReportFile = { key: string; file: ProblemReportFile };
export type SavedReport = { reportId: string; number: number };

/**
 * The files of a saved report: which reached it, so a retry sends only the
 * rest, and the stored bytes of each file whose registration has not answered.
 * `onFailure` names the file that is still missing.
 */
export function useReportFiles(
  onFailure: (report: SavedReport, file: ProblemReportFile, code: string) => void,
) {
  const [sentFiles, setSentFiles] = useState<ReadonlySet<string>>(new Set());
  const [storedFiles, setStoredFiles] = useState<ReadonlyMap<string, string>>(new Map());

  /** Sends what is still missing, through the upload actions of the person who filed the report. */
  const send = async (
    actions: ProblemReportFileActions,
    organizationId: string,
    report: SavedReport,
    files: readonly KeyedReportFile[],
  ): Promise<boolean> => {
    const sent = new Set(sentFiles);
    const stored = new Map(storedFiles);
    for (const { key, file } of files) {
      if (sent.has(key)) continue;
      const target = { organizationId, reportId: report.reportId };
      const { result, storedFileId } = await uploadProblemReportFile(
        actions,
        target,
        file,
        stored.get(key) ?? null,
      );
      if (storedFileId) stored.set(key, storedFileId);
      else stored.delete(key);
      setStoredFiles(new Map(stored));
      if (!result.success) {
        onFailure(report, file, result.error);
        return false;
      }
      sent.add(key);
      setSentFiles(new Set(sent));
    }
    return true;
  };

  // A file whose bytes left the device no longer changes: a retry sends those bytes.
  const frozen: ReadonlySet<string> = new Set([...sentFiles, ...storedFiles.keys()]);
  return { send, frozen };
}
