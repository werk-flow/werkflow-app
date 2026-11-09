'use client';

import { Suspense, use, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

import { useOrganization } from '@/components/organization/organization-context';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { FileInput } from '@/components/ui/file-input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { problemReportFailureMessage } from '@/lib/problem-reports/messages';
import type { RedactionBox } from '@/lib/problem-reports/redaction';
import {
  PROBLEM_REPORT_DESCRIPTION_MAX_LENGTH,
  PROBLEM_REPORT_FILE_RULES,
  PROBLEM_REPORT_MAX_ATTACHMENTS,
} from '@/lib/problem-reports/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import type { ProblemReportCapture } from './problem-report-launcher';
import { ScreenshotRedactor } from './screenshot-redactor';
import { useProblemReportSend, type ChosenAttachment } from './use-problem-report-send';

// The report dialog (docs/features/problem-reports.md). It loads on the
// press, together with the capture; the launcher took the screenshot before
// the dialog opened.

const DESCRIPTION_ID = 'problem-report-description';
const DESCRIPTION_MISSING = 'Beschreibe kurz, was passiert ist.';

export type ProblemReportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  capture: ProblemReportCapture;
};

export function ProblemReportDialog({ open, onOpenChange, capture }: ProblemReportDialogProps) {
  const { activeOrg } = useOrganization();
  const report = useProblemReportSend(capture, () => onOpenChange(false));
  const [description, setDescription] = useState('');
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [boxes, setBoxes] = useState<RedactionBox[]>([]);
  const [attachments, setAttachments] = useState<ChosenAttachment[]>([]);
  const [attempted, setAttempted] = useState(false);
  const descriptionError = description.trim() ? undefined : DESCRIPTION_MISSING;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField({ [DESCRIPTION_ID]: descriptionError })) return;
    if (!activeOrg) return report.setError(problemReportFailureMessage('no_active_org'));
    report.send(activeOrg.orgId, { description, includeScreenshot, boxes, attachments });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={report.isPending}>
      {/* The dialog renders outside the shell's main region, so it carries the field worker's touch targets itself. */}
      <DialogContent size="lg" data-field-worker={activeOrg?.role === 'employee' ? '' : undefined}>
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Problem melden</DialogTitle>
            <DialogDescription>
              Beschreibe, was nicht funktioniert. Deine Meldung geht an den WerkFlow-Support.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5 py-1">
            <Field
              label="Was ist passiert?"
              htmlFor={DESCRIPTION_ID}
              required
              description="Du kannst auch die Diktiertaste deiner Tastatur nutzen."
              error={attempted ? descriptionError : undefined}
            >
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={PROBLEM_REPORT_DESCRIPTION_MAX_LENGTH}
                rows={4}
                readOnly={report.saved}
                required
              />
            </Field>
            <section className="space-y-3" aria-labelledby="problem-report-screenshot-title">
              <h3 id="problem-report-screenshot-title" className="text-sm font-medium">
                Screenshot
              </h3>
              <Suspense fallback={<Skeleton className="h-48 w-full rounded-md" />}>
                <ScreenshotSection
                  screenshot={capture.screenshot}
                  include={includeScreenshot}
                  onIncludeChange={setIncludeScreenshot}
                  boxes={boxes}
                  onBoxesChange={setBoxes}
                  locked={report.isPending || report.frozenFiles.has('screenshot')}
                />
              </Suspense>
            </section>
            <AttachmentsField
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              frozenFiles={report.frozenFiles}
            />
            <ErrorText>{report.error}</ErrorText>
          </DialogBody>
          <ProblemReportFooter pending={report.isPending} onClose={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * „Meine Meldungen“ on the left; cancel and send on the right. While a send
 * runs, neither leaves the dialog, so its answer never lands in a closed one.
 */
function ProblemReportFooter({ pending, onClose }: { pending: boolean; onClose: () => void }) {
  return (
    <DialogFooter className="sm:justify-between">
      <Button variant="link" asChild className="px-0">
        <Link
          href="/meldungen"
          aria-disabled={pending || undefined}
          onClick={(event) => {
            if (pending) event.preventDefault();
            else onClose();
          }}
        >
          Meine Meldungen
        </Link>
      </Button>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
          Abbrechen
        </Button>
        <Button type="submit" pending={pending}>
          Senden
        </Button>
      </div>
    </DialogFooter>
  );
}

/** Why a chosen attachment cannot join the report, or null when it can. */
function attachmentProblem(file: File, chosen: number): string | null {
  const rule = PROBLEM_REPORT_FILE_RULES.anhang;
  if (chosen >= PROBLEM_REPORT_MAX_ATTACHMENTS) return problemReportFailureMessage('too_many_attachments');
  if (!rule.mimeTypes.includes(file.type)) return problemReportFailureMessage('file_type_not_allowed');
  if (file.size === 0) return problemReportFailureMessage('file_empty');
  return file.size > rule.maxSizeBytes ? problemReportFailureMessage('file_too_large') : null;
}

type AttachmentsFieldProps = {
  attachments: ChosenAttachment[];
  onAttachmentsChange: (update: (current: ChosenAttachment[]) => ChosenAttachment[]) => void;
  frozenFiles: ReadonlySet<string>;
};

function AttachmentsField({ attachments, onAttachmentsChange, frozenFiles }: AttachmentsFieldProps) {
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
          onSelect={(file) => {
            if (!file) return;
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
                disabled={frozenFiles.has(`anhang-${key}`)}
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

type ScreenshotSectionProps = {
  screenshot: Promise<ImageBitmap | null>;
  include: boolean;
  onIncludeChange: (include: boolean) => void;
  boxes: RedactionBox[];
  onBoxesChange: (boxes: RedactionBox[]) => void;
  /** True while sending and once the screenshot's bytes left the device: it no longer changes. */
  locked: boolean;
};

function ScreenshotSection({
  screenshot,
  include,
  onIncludeChange,
  boxes,
  onBoxesChange,
  locked,
}: ScreenshotSectionProps) {
  const image = use(screenshot);
  if (!image) {
    return (
      <p className="text-sm text-muted-foreground">
        Dieses Gerät konnte keinen Screenshot erstellen. Deine Meldung geht ohne Bild.
      </p>
    );
  }
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={include}
          disabled={locked}
          onCheckedChange={(checked) => onIncludeChange(checked === true)}
        />
        <span>Screenshot mitsenden</span>
      </label>
      {include && (
        <>
          <p className="text-sm text-muted-foreground">
            Kundendaten sind schon durch Platzhalter ersetzt. Ziehe Rechtecke über alles, was trotzdem niemand
            sehen soll. Sie werden schwarz, bevor das Bild dein Gerät verlässt.
          </p>
          <ScreenshotRedactor image={image} boxes={boxes} onBoxesChange={onBoxesChange} disabled={locked} />
          {boxes.length > 0 && !locked && (
            <Button type="button" variant="outline" onClick={() => onBoxesChange([])}>
              Schwärzungen entfernen
            </Button>
          )}
        </>
      )}
    </>
  );
}
