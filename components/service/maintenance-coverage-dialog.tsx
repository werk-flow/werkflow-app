"use client";

import { useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

import { ClientSelectWithCreate } from "@/components/auftraege/client-select-with-create";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorText } from "@/components/ui/error-text";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";
import { createMaintenanceCoverage } from "@/lib/maintenance/actions";
import type { MaintenanceClientOption } from "@/lib/maintenance/types";
import { formatBerlinLocalDate } from "@/lib/planning/date-time";

function toLocalDate(value: string): Date | undefined {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : undefined;
}

export function MaintenanceCoverageDialog({
  open,
  onOpenChange,
  clients,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: MaintenanceClientOption[];
}): ReactElement {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [noticeDate, setNoticeDate] = useState("");
  const [renewalDate, setRenewalDate] = useState("");
  const [reviewDueDate, setReviewDueDate] = useState("");
  const [operationalNote, setOperationalNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const mutationIdentity = useRef({
    coverageId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  });
  const client = clients.find((item) => item.id === clientId);
  const { run, isPending } = useServerAction(async () => {
    setError(null);
    const result = await createMaintenanceCoverage({
      coverageId: mutationIdentity.current.coverageId,
      clientId,
      siteId,
      reference: reference || null,
      description: description || null,
      status: "active",
      validFrom: validFrom || null,
      validUntil: validUntil || null,
      noticeDate: noticeDate || null,
      renewalDate: renewalDate || null,
      reviewDueDate: reviewDueDate || null,
      operationalNote: operationalNote || null,
      idempotencyKey: mutationIdentity.current.idempotencyKey,
    });
    if (!result.success) {
      setError(
        result.error === "maintenance_coverage_site_mismatch"
          ? "Der Einsatzort gehört nicht zum gewählten Kunden."
          : "Die operative Abdeckung konnte nicht gespeichert werden.",
      );
      return;
    }
    onOpenChange(false);
    router.refresh();
  });
  const clientError =
    attempted && !clientId ? "Bitte wähle einen Kunden." : undefined;
  const siteError =
    attempted && !siteId ? "Bitte wähle einen Einsatzort." : undefined;

  function submit(): void {
    setAttempted(true);
    if (!clientId || !siteId) {
      document
        .getElementById(clientId ? "coverage-site" : "coverage-client")
        ?.focus();
      return;
    }
    void run();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Operative Abdeckung erfassen</DialogTitle>
          <DialogDescription>
            Halte nur sichere Vertrags- und Fristdaten fest. Eine Verknüpfung
            bedeutet keine automatische Aussage über Kosten oder Gewährleistung.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <Field label="Kunde" htmlFor="coverage-client" required error={clientError}>
            <ClientSelectWithCreate
              clients={clients}
              value={clientId}
              onValueChange={(value) => {
                setClientId(value);
                setSiteId("");
              }}
            />
          </Field>
          <Field label="Einsatzort" htmlFor="coverage-site" required error={siteError}>
            <SearchableSelect
              value={siteId}
              onChange={setSiteId}
              options={(client?.sites ?? []).map((site) => ({
                value: site.id,
                label: site.name,
                description: site.address,
              }))}
              disabled={!client}
              placeholder="Einsatzort wählen"
              searchPlaceholder="Einsatzort suchen…"
              emptyMessage="Kein Einsatzort gefunden"
            />
          </Field>
          <Field
            label="Vertrags- oder Referenznummer (optional)"
            htmlFor="coverage-reference"
            className="sm:col-span-2"
          >
            <Input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </Field>
          <Field
            label="Beschreibung (optional)"
            htmlFor="coverage-description"
            className="sm:col-span-2"
          >
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field label="Gültig ab" htmlFor="coverage-valid-from">
            <DatePicker
              ariaLabel="Gültig ab"
              value={toLocalDate(validFrom)}
              onChange={(value) =>
                setValidFrom(value ? formatBerlinLocalDate(value) : "")
              }
            />
          </Field>
          <Field label="Gültig bis" htmlFor="coverage-valid-until">
            <DatePicker
              ariaLabel="Gültig bis"
              value={toLocalDate(validUntil)}
              onChange={(value) =>
                setValidUntil(value ? formatBerlinLocalDate(value) : "")
              }
            />
          </Field>
          <Field label="Kündigungsfrist prüfen am" htmlFor="coverage-notice">
            <DatePicker
              ariaLabel="Kündigungsfrist prüfen am"
              value={toLocalDate(noticeDate)}
              onChange={(value) =>
                setNoticeDate(value ? formatBerlinLocalDate(value) : "")
              }
            />
          </Field>
          <Field label="Verlängerung am" htmlFor="coverage-renewal">
            <DatePicker
              ariaLabel="Verlängerung am"
              value={toLocalDate(renewalDate)}
              onChange={(value) =>
                setRenewalDate(value ? formatBerlinLocalDate(value) : "")
              }
            />
          </Field>
          <Field
            label="Interne Wiedervorlage"
            htmlFor="coverage-review"
            className="sm:col-span-2"
          >
            <DatePicker
              ariaLabel="Interne Wiedervorlage"
              value={toLocalDate(reviewDueDate)}
              onChange={(value) =>
                setReviewDueDate(value ? formatBerlinLocalDate(value) : "")
              }
            />
          </Field>
          <Field
            label="Operativer Hinweis"
            htmlFor="coverage-note"
            className="sm:col-span-2"
          >
            <Textarea
              value={operationalNote}
              onChange={(event) => setOperationalNote(event.target.value)}
              placeholder="Nur bestätigte Hinweise, keine vermutete Kostenübernahme"
            />
          </Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Abbrechen
          </Button>
          <Button type="button" onClick={submit} disabled={isPending}>
            {isPending ? "Speichert…" : "Abdeckung speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
