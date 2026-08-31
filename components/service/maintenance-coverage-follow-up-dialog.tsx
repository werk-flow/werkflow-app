"use client";

import { useState, type ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/date-time-field";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";
import { createCustomerFollowUp } from "@/lib/customer-relationships/actions";
import {
  parseBerlinDateTimeInput,
  tomorrowMorningInBerlin,
} from "@/lib/customer-relationships/date-time";
import type {
  MaintenanceCoverageItem,
  MaintenanceWorkspace,
} from "@/lib/maintenance/types";

export function MaintenanceCoverageFollowUpDialog({
  open,
  onOpenChange,
  coverage,
  currentActorId,
  owners,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coverage: MaintenanceCoverageItem;
  currentActorId: string;
  owners: MaintenanceWorkspace["followUpOwners"];
}): ReactElement {
  const [title, setTitle] = useState(
    `Abdeckung ${coverage.coverageNumber} prüfen`,
  );
  const [note, setNote] = useState(coverage.operationalNote ?? "");
  const [ownerUserId, setOwnerUserId] = useState(
    owners.find((owner) => owner.userId === currentActorId)?.userId ??
      owners[0]?.userId ??
      "",
  );
  const [dueAt, setDueAt] = useState(() => tomorrowMorningInBerlin());
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useServerAction(async () => {
    const dueDate = parseBerlinDateTimeInput(dueAt);
    if (!title.trim() || !ownerUserId || !dueDate) {
      setError("Bitte fülle Titel, Zuständigkeit und Fälligkeit aus.");
      return;
    }
    const result = await createCustomerFollowUp(coverage.clientId, {
      title,
      note,
      ownerUserId,
      dueAt: dueDate.toISOString(),
      sourceType: "maintenance_coverage",
      sourceId: coverage.id,
    });
    if (!result.success) {
      setError("Die Nachfassaktion konnte nicht angelegt werden.");
      return;
    }
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nachfassaktion anlegen</DialogTitle>
          <DialogDescription>
            Die Wiedervorlage bleibt eine bestehende Kunden-Nachfassaktion und
            verweist exakt auf diese operative Abdeckung.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            Quelle: {coverage.coverageNumber}
          </p>
          <div className="space-y-2">
            <Label htmlFor="coverage-follow-up-title">Titel</Label>
            <Input
              id="coverage-follow-up-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="coverage-follow-up-owner">Zuständig</Label>
            <SearchableSelect
              id="coverage-follow-up-owner"
              value={ownerUserId}
              onChange={setOwnerUserId}
              options={owners.map((owner) => ({
                value: owner.userId,
                label: owner.name,
              }))}
              placeholder="Person wählen"
              searchPlaceholder="Person suchen…"
              emptyMessage="Keine Person gefunden"
            />
          </div>
          <div className="space-y-2">
            <Label>Fällig am</Label>
            <DateTimeField
              idPrefix="coverage-follow-up-due"
              value={dueAt}
              onChange={setDueAt}
              dateAriaLabel="Fälligkeitsdatum"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="coverage-follow-up-note">Notiz</Label>
            <Textarea
              id="coverage-follow-up-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
              rows={4}
            />
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
            <Button type="submit" disabled={isPending}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
