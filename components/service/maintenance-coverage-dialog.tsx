"use client";

import { useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
          <div className="space-y-2">
            <Label htmlFor="coverage-client">Kunde</Label>
            <Select
              value={clientId}
              onValueChange={(value) => {
                setClientId(value);
                setSiteId("");
              }}
            >
              <SelectTrigger id="coverage-client">
                <SelectValue placeholder="Kunde wählen" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="coverage-site">Einsatzort</Label>
            <Select value={siteId} onValueChange={setSiteId} disabled={!client}>
              <SelectTrigger id="coverage-site">
                <SelectValue placeholder="Einsatzort wählen" />
              </SelectTrigger>
              <SelectContent>
                {client?.sites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="coverage-reference">
              Vertrags- oder Referenznummer (optional)
            </Label>
            <Input
              id="coverage-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="coverage-description">
              Beschreibung (optional)
            </Label>
            <Textarea
              id="coverage-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="coverage-valid-from">Gültig ab</Label>
            <DatePicker
              id="coverage-valid-from"
              ariaLabel="Gültig ab"
              value={toLocalDate(validFrom)}
              onChange={(value) =>
                setValidFrom(value ? formatBerlinLocalDate(value) : "")
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="coverage-valid-until">Gültig bis</Label>
            <DatePicker
              id="coverage-valid-until"
              ariaLabel="Gültig bis"
              value={toLocalDate(validUntil)}
              onChange={(value) =>
                setValidUntil(value ? formatBerlinLocalDate(value) : "")
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="coverage-notice">Kündigungsfrist prüfen am</Label>
            <DatePicker
              id="coverage-notice"
              ariaLabel="Kündigungsfrist prüfen am"
              value={toLocalDate(noticeDate)}
              onChange={(value) =>
                setNoticeDate(value ? formatBerlinLocalDate(value) : "")
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="coverage-renewal">Verlängerung am</Label>
            <DatePicker
              id="coverage-renewal"
              ariaLabel="Verlängerung am"
              value={toLocalDate(renewalDate)}
              onChange={(value) =>
                setRenewalDate(value ? formatBerlinLocalDate(value) : "")
              }
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="coverage-review">Interne Wiedervorlage</Label>
            <DatePicker
              id="coverage-review"
              ariaLabel="Interne Wiedervorlage"
              value={toLocalDate(reviewDueDate)}
              onChange={(value) =>
                setReviewDueDate(value ? formatBerlinLocalDate(value) : "")
              }
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="coverage-note">Operativer Hinweis</Label>
            <Textarea
              id="coverage-note"
              value={operationalNote}
              onChange={(event) => setOperationalNote(event.target.value)}
              placeholder="Nur bestätigte Hinweise, keine vermutete Kostenübernahme"
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Abbrechen
          </Button>
          <Button type="button" onClick={() => void run()} disabled={isPending}>
            {isPending ? "Speichert…" : "Abdeckung speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
