'use client';

import { useRef, useState } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FileInput } from '@/components/ui/file-input';
import { problemReportFailureMessage } from '@/lib/problem-reports/messages';
import { PROBLEM_REPORT_FILE_RULES, PROBLEM_REPORT_MAX_ATTACHMENTS } from '@/lib/problem-reports/types';
import type { ChosenAttachment } from './use-report-files';

// The attachments of a report in the making: the reporter's own, or the ones
// support adds for a caller.

/** Why a chosen attachment cannot join the report, or null when it can. */
function attachmentProblem(file: File, chosen: number): string | null {
  const rule = PROBLEM_REPORT_FILE_RULES.anhang;
  if (chosen >= PROBLEM_REPORT_MAX_ATTACHMENTS) return problemReportFailureMessage('too_many_attachments');
  if (!rule.mimeTypes.includes(file.type)) return problemReportFailureMessage('file_type_not_allowed');
  if (file.size === 0) return problemReportFailureMessage('file_empty');
  return file.size > rule.maxSizeBytes ? problemReportFailureMessage('file_too_large') : null;
}

type AttachmentsFieldProps = {
  attachments: readonly ChosenAttachment[];
  onAttachmentsChange: (update: (current: ChosenAttachment[]) => ChosenAttachment[]) => void;
  frozenFiles: ReadonlySet<string>;
  /** While a send runs, the list it sends stays as it is. */
  disabled: boolean;
};

export function AttachmentsField({
  attachments,
  onAttachmentsChange,
  frozenFiles,
  disabled,
}: AttachmentsFieldProps) {
  const [problem, setProblem] = useState<string | null>(null);
  const nextKey = useRef(1);
  return (
    <>
      <Field
        label="Anhänge"
        htmlFor="problem-report-attachment"
        description="Fotos oder PDFs, höchstens fünf. Sie bleiben bei WerkFlow."
        error={problem}
      >
        <FileInput
          buttonLabel="Foto oder PDF anhängen"
          fileName={null}
          accept={PROBLEM_REPORT_FILE_RULES.anhang.mimeTypes.join(',')}
          disabled={disabled}
          onSelect={(file) => {
            if (!file) return;
            // A chooser opened before the send can close after it started; that file joins no send.
            if (disabled) return setProblem('Die Meldung wird gerade gesendet. Hänge die Datei danach an.');
            const refusal = attachmentProblem(file, attachments.length);
            setProblem(refusal);
            if (refusal) return;
            const key = nextKey.current;
            nextKey.current += 1;
            onAttachmentsChange((current) => [...current, { key, file }]);
          }}
        />
      </Field>
      {attachments.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {attachments.map(({ key, file }) => (
            <li key={key} className="flex items-center gap-2 py-1 pr-1 pl-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`„${file.name}“ entfernen`}
                disabled={disabled || frozenFiles.has(`anhang-${key}`)}
                onClick={() => onAttachmentsChange((current) => current.filter((entry) => entry.key !== key))}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
