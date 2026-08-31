"use client";

import { useEffect, useState, type ReactElement } from "react";

import { ContextualDocumentsSection } from "@/components/dokumente/contextual-documents-section";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getMaintenanceCoverageDocuments } from "@/lib/documents/actions";
import type { OrganizationDocument } from "@/lib/documents/types";
import type { MaintenanceCoverageItem } from "@/lib/maintenance/types";

export function MaintenanceCoverageDocumentsDialog({
  open,
  onOpenChange,
  coverage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coverage: MaintenanceCoverageItem;
}): ReactElement {
  const [documents, setDocuments] = useState<OrganizationDocument[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let current = true;
    void getMaintenanceCoverageDocuments(coverage.id).then((result) => {
      if (!current) return;
      if (result.success) {
        setDocuments(result.documents);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
    return () => {
      current = false;
    };
  }, [coverage.id, open]);
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
        {failed ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Dokumente konnten nicht geladen werden.
          </p>
        ) : (
          <ContextualDocumentsSection
            title="Dokumente & Bilder"
            description="Bestätigte Vertrags- und Fristunterlagen dieser operativen Abdeckung."
            documents={documents}
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
