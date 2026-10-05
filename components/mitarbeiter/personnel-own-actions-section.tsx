'use client';

import { useId, useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';

import { useBanner } from '@/components/ui/banner';
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
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { useServerAction } from '@/hooks/use-server-action';
import { readInBackground } from '@/lib/data/background-read-client';
import { uploadPersonnelDocumentDirect } from '@/lib/documents/upload-client';
import {
  acknowledgePersonnelDocument,
  acknowledgePersonnelRequirement,
  getPersonnelDocumentSignedUrl,
  type OwnPersonnelActions,
} from '@/lib/personnel/lifecycle-actions';
import { PersonnelOwnDocumentList, PersonnelOwnRequirementList } from './personnel-own-actions-lists';
import { describeFailure } from '@/lib/action-messages';

type EvidenceFieldErrors = { file?: string | undefined; type?: string | undefined };

function PersonnelOwnActionsHeader({ prestart, onUpload }: { prestart: boolean; onUpload: () => void }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="own-personnel-actions-title" className="text-sm font-semibold">
          Meine Personalaufgaben
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {prestart
            ? 'Bis zum Zugangsstart siehst du nur freigegebene Unterlagen und deine Onboardingaufgaben.'
            : 'Freigegebene Personalunterlagen und Aufgaben, die dich selbst betreffen.'}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onUpload}>
        <FileUp className="size-4" /> Nachweis hochladen
      </Button>
    </div>
  );
}

function PersonnelEvidenceUploadDialog({
  open,
  isPending,
  onOpenChange,
  formId,
  fieldErrors,
  documentType,
  onFileChange,
  onDocumentTypeChange,
  error,
  onSubmit,
}: {
  open: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  formId: string;
  fieldErrors: EvidenceFieldErrors;
  documentType: string;
  onFileChange: (file: File | null) => void;
  onDocumentTypeChange: (documentType: string) => void;
  error: string | null;
  onSubmit: () => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gesundheitsnachweis hochladen</DialogTitle>
          <DialogDescription>
            Die Datei wird geschützt gespeichert. Andere Beschäftigte und Büro-Nutzer sehen sie nicht.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 py-1">
          <form
            id={formId}
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!isPending) void onSubmit();
            }}
          >
            <Field label="Datei" htmlFor="own-evidence-file" required error={fieldErrors.file}>
              <Input type="file" onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} />
            </Field>
            <Field label="Dokumentart" htmlFor="own-evidence-type" required error={fieldErrors.type}>
              <Input value={documentType} onChange={(event) => onDocumentTypeChange(event.target.value)} />
            </Field>
            <p className="text-xs text-muted-foreground">
              Keine Diagnose oder medizinischen Details in WerkFlow erfassen.
            </p>
            <ErrorText>{error}</ErrorText>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Abbrechen
          </Button>
          <Button type="submit" form={formId} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}Hochladen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function PersonnelOwnActionsSection({ forceVisible = false }: { forceVisible?: boolean }) {
  const { showBanner } = useBanner();
  const evidenceFormId = useId();
  const { run: runBusy, isBusy } = useBusyIds();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState('Krankheitsnachweis');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<EvidenceFieldErrors>({});
  const { run, isPending } = useServerAction(async (task: () => Promise<void>) => task());
  const view = useLiveView<OwnPersonnelActions>({
    tables: [
      'personnel_documents',
      'personnel_document_releases',
      'personnel_onboarding_plans',
      'personnel_onboarding_requirements',
    ],
    read: async ({ signal }): Promise<LiveViewResult<OwnPersonnelActions>> => {
      const result = await readInBackground('own-personnel-actions', {}, signal);
      return result.success ? { ok: true, data: result.data } : { ok: false };
    },
  });

  if (view.isLoading) return <Skeleton className="h-28 w-full" />;
  if (!view.data) {
    return forceVisible ? (
      <SectionError onRetry={() => void view.refresh()} retryPending={view.isRefreshing}>
        Deine persönlichen Aufgaben konnten nicht geladen werden.
      </SectionError>
    ) : null;
  }
  const { requirements, documents, prestart } = view.data;
  if (!forceVisible && requirements.length === 0 && documents.length === 0) return null;

  async function acknowledge(requirementId: string, requirementVersion: number): Promise<void> {
    setError(null);
    await runBusy(requirementId, async () => {
      try {
        const result = await acknowledgePersonnelRequirement({
          requirementId,
          requirementVersion,
          statement: 'Von mir als erledigt bestätigt.',
          operationId: crypto.randomUUID(),
        });
        if (!result.success)
          setError(
            describeFailure(
              result.error,
              { stale_version: 'Die Aufgabe wurde inzwischen geändert.' },
              'Die Bestätigung konnte nicht gespeichert werden.',
            ),
          );
        else showBanner({ variant: 'success', message: 'Die Bestätigung wurde gespeichert.' });
        await view.refresh();
      } catch {
        setError('Die Bestätigung konnte nicht gespeichert werden.');
      }
    });
  }

  async function download(rowId: string, documentId: string): Promise<void> {
    await runBusy(rowId, async () => {
      try {
        const result = await getPersonnelDocumentSignedUrl(documentId);
        if (!result.success) {
          setError('Das Dokument konnte nicht geöffnet werden.');
          return;
        }
        window.location.assign(result.data.signedUrl);
      } catch {
        setError('Das Dokument konnte nicht geöffnet werden.');
      }
    });
  }

  async function acknowledgeDocument(personnelDocumentId: string, version: number): Promise<void> {
    setError(null);
    await runBusy(personnelDocumentId, async () => {
      try {
        const result = await acknowledgePersonnelDocument({
          personnelDocumentId,
          documentVersionNumber: version,
          statement: 'Erhalt dieser Dokumentversion bestätigt.',
          operationId: crypto.randomUUID(),
        });
        if (!result.success) {
          setError('Die Empfangsbestätigung konnte nicht gespeichert werden.');
        } else {
          showBanner({ variant: 'success', message: 'Der Erhalt der Dokumentversion wurde bestätigt.' });
          await view.refresh();
        }
      } catch {
        setError('Die Empfangsbestätigung konnte nicht gespeichert werden.');
      }
    });
  }

  async function uploadEvidence(): Promise<void> {
    setError(null);
    const nextFieldErrors = {
      file: file ? undefined : 'Bitte wähle eine Datei aus.',
      type: documentType.trim().length < 2 ? 'Bitte gib die Dokumentart an.' : undefined,
    };
    setFieldErrors(nextFieldErrors);
    if (!file || nextFieldErrors.type) {
      document.getElementById(nextFieldErrors.file ? 'own-evidence-file' : 'own-evidence-type')?.focus();
      return;
    }
    const employeeRecordId = view.data?.employeeRecordId;
    if (!employeeRecordId) return;
    await run(async () => {
      const result = await uploadPersonnelDocumentDirect({
        employeeRecordId,
        file,
        documentType,
        accessClass: 'health_evidence',
        evidenceState: 'valid',
        validUntil: null,
        operationId: crypto.randomUUID(),
      });
      if (!result.success) {
        setError('Der Nachweis konnte nicht hochgeladen werden.');
        return;
      }
      setUploadOpen(false);
      setFile(null);
      showBanner({ variant: 'success', message: 'Der Gesundheitsnachweis wurde hochgeladen.' });
      await view.refresh();
    });
  }

  return (
    <section
      className="space-y-4 rounded-lg border bg-card p-4 shadow-xs"
      aria-labelledby="own-personnel-actions-title"
      data-testid="personnel-own-actions"
    >
      <PersonnelOwnActionsHeader
        prestart={prestart}
        onUpload={() => {
          // The file input remounts empty, so a file from an earlier opening must not upload.
          setFile(null);
          setError(null);
          setFieldErrors({});
          setUploadOpen(true);
        }}
      />
      {requirements.length === 0 && documents.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Keine offenen Personalaufgaben oder freigegebenen Unterlagen.
        </p>
      ) : null}
      {requirements.length > 0 ? (
        <PersonnelOwnRequirementList
          requirements={requirements}
          isBusy={isBusy}
          onAcknowledge={acknowledge}
        />
      ) : null}
      {documents.length > 0 ? (
        <PersonnelOwnDocumentList
          documents={documents}
          isBusy={isBusy}
          onDownload={download}
          onAcknowledge={acknowledgeDocument}
        />
      ) : null}
      {!uploadOpen && <ErrorText>{error}</ErrorText>}

      <PersonnelEvidenceUploadDialog
        open={uploadOpen}
        isPending={isPending}
        onOpenChange={setUploadOpen}
        formId={evidenceFormId}
        fieldErrors={fieldErrors}
        documentType={documentType}
        onFileChange={setFile}
        onDocumentTypeChange={setDocumentType}
        error={error}
        onSubmit={uploadEvidence}
      />
    </section>
  );
}
