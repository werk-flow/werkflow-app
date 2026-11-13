'use client';

import { Suspense, use, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Maximize2 } from 'lucide-react';

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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { problemReportFailureMessage } from '@/lib/problem-reports/messages';
import type { RedactionBox } from '@/lib/problem-reports/redaction';
import { PROBLEM_REPORT_DESCRIPTION_MAX_LENGTH } from '@/lib/problem-reports/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { AttachmentsField } from './attachments-field';
import type { ProblemReportCapture } from './problem-report-launcher';
import { ScreenshotRedactionView } from './screenshot-redaction-view';
import { ScreenshotRedactor } from './screenshot-redactor';
import { useProblemReportSend } from './use-problem-report-send';
import type { ChosenAttachment } from './use-report-files';

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
                readOnly={report.descriptionFrozen}
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
                  fieldWorker={activeOrg?.role === 'employee'}
                />
              </Suspense>
            </section>
            <AttachmentsField
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              frozenFiles={report.frozenFiles}
              disabled={report.isPending}
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

type ScreenshotSectionProps = {
  screenshot: Promise<ImageBitmap | null>;
  include: boolean;
  onIncludeChange: (include: boolean) => void;
  boxes: RedactionBox[];
  onBoxesChange: (boxes: RedactionBox[]) => void;
  /** True while sending and once the screenshot's bytes left the device: it no longer changes. */
  locked: boolean;
  fieldWorker: boolean;
};

function ScreenshotSection({
  screenshot,
  include,
  onIncludeChange,
  boxes,
  onBoxesChange,
  locked,
  fieldWorker,
}: ScreenshotSectionProps) {
  const image = use(screenshot);
  const [enlarged, setEnlarged] = useState(false);
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
            sehen soll. Sie werden fest abgedeckt, bevor das Bild dein Gerät verlässt.
          </p>
          <ScreenshotRedactor
            image={image}
            boxes={boxes}
            onBoxesChange={onBoxesChange}
            disabled={locked}
            label="Vorschau des Screenshots mit deinen Schwärzungen"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setEnlarged(true)}>
              <Maximize2 aria-hidden />
              Vergrößern
            </Button>
            {boxes.length > 0 && !locked && (
              <Button type="button" variant="outline" onClick={() => onBoxesChange([])}>
                Schwärzungen entfernen
              </Button>
            )}
          </div>
          <ScreenshotRedactionView
            open={enlarged}
            onOpenChange={setEnlarged}
            image={image}
            boxes={boxes}
            onBoxesChange={onBoxesChange}
            disabled={locked}
            fieldWorker={fieldWorker}
          />
        </>
      )}
    </>
  );
}
