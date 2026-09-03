"use client";
import { SectionError } from "@/components/ui/section-error";

import { useEffect, useState, type ReactElement } from "react";

import { ContextualDocumentsSection } from "@/components/dokumente/contextual-documents-section";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { getMaintenanceCoverageDocuments } from "@/lib/documents/actions";
import type { OrganizationDocument } from "@/lib/documents/types";
import type { MaintenanceCoverageItem } from "@/lib/maintenance/types";

type DocumentsState =
  | { status: "loading" }
  | { status: "ready"; documents: OrganizationDocument[] }
  | { status: "failed" };

export function MaintenanceCoverageDocumentsDialog({
  open,
  onOpenChange,
  coverage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coverage: MaintenanceCoverageItem;
}): ReactElement {
  const [state, setState] = useState<DocumentsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let current = true;
    getMaintenanceCoverageDocuments(coverage.id).then(
      (result) => {
        if (!current) return;
        setState(
          result.success
            ? { status: "ready", documents: result.documents }
            : { status: "failed" },
        );
      },
      () => {
        if (current) setState({ status: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [coverage.id, open, attempt]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Dokumente zu {coverage.coverageNumber}</DialogTitle>
          <DialogDescription>
            Vertragsunterlagen werden aus der zentralen Ablage verknüpft. Es
            entsteht keine Dateikopie.
          </DialogDescription>
        </DialogHeader>
        {state.status === "loading" ? (
          <div className="space-y-3" role="status" aria-busy="true">
            <span className="sr-only">Dokumente werden geladen.</span>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : state.status === "failed" ? (
          <SectionError
            onRetry={() => {
              setState({ status: "loading" });
              setAttempt((count) => count + 1);
            }}
          >
            Die Dokumente dieser Abdeckung konnten nicht geladen werden.
          </SectionError>
        ) : (
          <ContextualDocumentsSection
            title="Dokumente & Bilder"
            description="Bestätigte Vertrags- und Fristunterlagen dieser operativen Abdeckung."
            documents={state.documents}
            documentTarget={{
              kind: "maintenance_coverage",
              maintenanceCoverageId: coverage.id,
            }}
            contextLabel={coverage.coverageNumber}
            canUpload
            canManage
            keepUploadedDocumentsVisible
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
