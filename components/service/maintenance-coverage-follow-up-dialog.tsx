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
import { ErrorText } from "@/components/ui/error-text";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  const [attempted, setAttempted] = useState(false);
  const { run, isPending } = useServerAction(async () => {
    const dueDate = parseBerlinDateTimeInput(dueAt);
    if (!dueDate) return;
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
  const titleError =
    attempted && !title.trim() ? "Bitte gib einen Titel ein." : undefined;
  const ownerError =
    attempted && !ownerUserId ? "Bitte wähle eine zuständige Person." : undefined;
  const dueError =
    attempted && !parseBerlinDateTimeInput(dueAt)
      ? "Bitte gib eine Fälligkeit an."
      : undefined;

  function submit(): void {
    setError(null);
    setAttempted(true);
    const firstInvalidId = !title.trim()
      ? "coverage-follow-up-title"
      : !ownerUserId
        ? "coverage-follow-up-owner"
        : !parseBerlinDateTimeInput(dueAt)
          ? "coverage-follow-up-due-date"
          : null;
    if (firstInvalidId) {
      document.getElementById(firstInvalidId)?.focus();
      return;
    }
    void run();
  }

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
            submit();
          }}
        >
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            Quelle: {coverage.coverageNumber}
          </p>
          <Field
            label="Titel"
            htmlFor="coverage-follow-up-title"
            required
            error={titleError}
          >
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              autoFocus
            />
          </Field>
          <Field
            label="Zuständig"
            htmlFor="coverage-follow-up-owner"
            required
            error={ownerError}
          >
            <SearchableSelect
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
          </Field>
          <Field
            label="Fällig am"
            htmlFor="coverage-follow-up-due-date"
            required
            error={dueError}
          >
            <DateTimeField
              idPrefix="coverage-follow-up-due"
              value={dueAt}
              onChange={setDueAt}
              dateAriaLabel="Fälligkeitsdatum"
              invalid={Boolean(dueError)}
            />
          </Field>
          <Field label="Notiz" htmlFor="coverage-follow-up-note">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
            />
          </Field>
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
            <Button type="submit" disabled={isPending}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
