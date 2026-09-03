"use client";

import { useState } from "react";
import { Check, Download, FileUp, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorText } from "@/components/ui/error-text";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveView, type LiveViewResult } from "@/hooks/use-live-view";
import { useServerAction } from "@/hooks/use-server-action";
import { uploadPersonnelDocumentDirect } from "@/lib/documents/upload-client";
import {
  acknowledgePersonnelDocument,
  acknowledgePersonnelRequirement,
  getOwnPersonnelActions,
  getPersonnelDocumentSignedUrl,
  type OwnPersonnelActions,
} from "@/lib/personnel/lifecycle-actions";
import { REQUIREMENT_STATE_LABELS } from "@/lib/personnel/lifecycle";

export function PersonnelOwnActionsSection({ forceVisible = false }: { forceVisible?: boolean }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("Krankheitsnachweis");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ file?: string; type?: string }>({});
  const { run, isPending } = useServerAction(async (task: () => Promise<void>) => task());
  const view = useLiveView<OwnPersonnelActions>({
    tables: [
      "personnel_documents",
      "personnel_document_releases",
      "personnel_onboarding_plans",
      "personnel_onboarding_requirements",
    ],
    read: async (): Promise<LiveViewResult<OwnPersonnelActions>> => {
      const result = await getOwnPersonnelActions();
      return result.success ? { ok: true, data: result.data } : { ok: false };
    },
  });

  if (view.isLoading) return <Skeleton className="h-28 w-full" />;
  if (!view.data) {
    return forceVisible ? (
      <ErrorText className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
        Deine persönlichen Aufgaben konnten nicht geladen werden. Bitte melde dich erneut an.
      </ErrorText>
    ) : null;
  }
  const { requirements, documents, prestart } = view.data;
  if (!forceVisible && requirements.length === 0 && documents.length === 0) return null;

  async function acknowledge(requirementId: string, requirementVersion: number): Promise<void> {
    setBusyId(requirementId);
    setError(null);
    try {
      const result = await acknowledgePersonnelRequirement({
        requirementId,
        requirementVersion,
        statement: "Von mir als erledigt bestätigt.",
        operationId: crypto.randomUUID(),
      });
      if (!result.success) setError(result.error === "stale_version" ? "Die Aufgabe wurde inzwischen geändert." : "Die Bestätigung konnte nicht gespeichert werden.");
      await view.refresh();
    } catch {
      setError("Die Bestätigung konnte nicht gespeichert werden.");
    } finally {
      setBusyId(null);
    }
  }

  async function download(documentId: string): Promise<void> {
    setBusyId(documentId);
    try {
      const result = await getPersonnelDocumentSignedUrl(documentId);
      if (!result.success) {
        setError("Das Dokument konnte nicht geöffnet werden.");
        return;
      }
      window.location.assign(result.data.signedUrl);
    } catch {
      setError("Das Dokument konnte nicht geöffnet werden.");
    } finally {
      setBusyId(null);
    }
  }

  async function acknowledgeDocument(personnelDocumentId: string, version: number): Promise<void> {
    setBusyId(personnelDocumentId);
    setError(null);
    try {
      const result = await acknowledgePersonnelDocument({
        personnelDocumentId,
        documentVersionNumber: version,
        statement: "Erhalt dieser Dokumentversion bestätigt.",
        operationId: crypto.randomUUID(),
      });
      if (!result.success) {
        setError("Die Empfangsbestätigung konnte nicht gespeichert werden.");
      } else {
        await view.refresh();
      }
    } catch {
      setError("Die Empfangsbestätigung konnte nicht gespeichert werden.");
    } finally {
      setBusyId(null);
    }
  }

  async function uploadEvidence(): Promise<void> {
    const nextFieldErrors = {
      file: file ? undefined : "Bitte wähle eine Datei aus.",
      type: documentType.trim().length < 2 ? "Bitte gib die Dokumentart an." : undefined,
    };
    setFieldErrors(nextFieldErrors);
    if (!file || nextFieldErrors.type) {
      document.getElementById(nextFieldErrors.file ? "own-evidence-file" : "own-evidence-type")?.focus();
      return;
    }
    await run(async () => {
      const result = await uploadPersonnelDocumentDirect({
        employeeRecordId: view.data!.employeeRecordId,
        file,
        documentType,
        accessClass: "health_evidence",
        evidenceState: "valid",
        validUntil: null,
        operationId: crypto.randomUUID(),
      });
      if (!result.success) {
        setError("Der Nachweis konnte nicht hochgeladen werden.");
        return;
      }
      setUploadOpen(false);
      setFile(null);
      await view.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4 shadow-xs" aria-labelledby="own-personnel-actions-title" data-testid="personnel-own-actions">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="own-personnel-actions-title" className="text-sm font-semibold">Meine Personalaufgaben</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {prestart ? "Bis zum Zugangsstart siehst du nur freigegebene Unterlagen und deine Onboardingaufgaben." : "Freigegebene Personalunterlagen und Aufgaben, die dich selbst betreffen."}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => { setError(null); setFieldErrors({}); setUploadOpen(true); }}><FileUp className="size-4" /> Nachweis hochladen</Button>
      </div>
      {requirements.length === 0 && documents.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Keine offenen Personalaufgaben oder freigegebenen Unterlagen.</p>
      ) : null}
      {requirements.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {requirements.map((requirement) => (
            <li key={requirement.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{requirement.title}</p>
                <p className="text-xs text-muted-foreground">{requirement.blockerReason ?? requirement.description ?? (requirement.isRequired ? "Erforderlich" : "Optional")}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={requirement.state === "blocked" ? "destructive" : "secondary"}>{REQUIREMENT_STATE_LABELS[requirement.state]}</Badge>
                {requirement.requirementType === "acknowledgement" &&
                (requirement.state === "missing" || requirement.state === "pending") ? (
                  <Button size="sm" onClick={() => void acknowledge(requirement.id, requirement.version)} disabled={busyId !== null}>
                    {busyId === requirement.id ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Bestätigen
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {documents.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0"><p className="truncate text-sm font-medium">{document.displayName}</p><p className="text-xs text-muted-foreground">{document.documentType} · Version {document.currentVersionNumber}</p></div>
              <div className="flex flex-wrap justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => void download(document.documentId)} disabled={busyId !== null}><Download className="size-4" /> Öffnen</Button>
                <Button size="sm" variant="outline" onClick={() => void acknowledgeDocument(document.id, document.currentVersionNumber)} disabled={busyId !== null}><Check className="size-4" /> Erhalt bestätigen</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <ErrorText>{error}</ErrorText>

      <Dialog open={uploadOpen} onOpenChange={(open) => { if (!isPending) setUploadOpen(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Gesundheitsnachweis hochladen</DialogTitle><DialogDescription>Die Datei wird geschützt gespeichert. Andere Beschäftigte und Büro-Nutzer sehen sie nicht.</DialogDescription></DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <Field label="Datei" htmlFor="own-evidence-file" required error={fieldErrors.file}><Input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></Field>
            <Field label="Dokumentart" htmlFor="own-evidence-type" required error={fieldErrors.type}><Input value={documentType} onChange={(event) => setDocumentType(event.target.value)} /></Field>
            <p className="text-xs text-muted-foreground">Keine Diagnose oder medizinischen Details in WerkFlow erfassen.</p>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter><Button variant="outline" onClick={() => setUploadOpen(false)} disabled={isPending}>Abbrechen</Button><Button onClick={() => void uploadEvidence()} disabled={isPending}>{isPending && <Loader2 className="size-4 animate-spin" />}Hochladen</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
