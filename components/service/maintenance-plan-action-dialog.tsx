"use client";

import { useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
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
import { useServerAction } from "@/hooks/use-server-action";
import {
  setMaintenancePlanArchived,
  transitionMaintenancePlan,
} from "@/lib/maintenance/actions";
import type {
  MaintenancePlanItem,
  MaintenancePlanStatus,
} from "@/lib/maintenance/types";

export function MaintenancePlanActionDialog({
  open,
  onOpenChange,
  plan,
  toStatus,
  archived,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: MaintenancePlanItem;
  toStatus?: Exclude<MaintenancePlanStatus, "draft">;
  archived?: boolean;
}): ReactElement {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const { run, isPending } = useServerAction(async () => {
    setError(null);
    setReasonError(null);
    if (reason.trim().length < 3) {
      setReasonError("Gib eine kurze Begründung ein.");
      reasonRef.current?.focus();
      return;
    }
    const result = toStatus
      ? await transitionMaintenancePlan({
          planId: plan.id,
          expectedVersion: plan.version,
          toStatus,
          reason,
          idempotencyKey: idempotencyKey.current,
        })
      : await setMaintenancePlanArchived({
          planId: plan.id,
          expectedVersion: plan.version,
          archived: archived ?? true,
          reason,
          idempotencyKey: idempotencyKey.current,
        });
    if (!result.success) {
      const messages: Record<string, string> = {
        maintenance_stale_version:
          "Der Wartungsplan wurde inzwischen geändert. Bitte lade die Seite neu.",
        maintenance_reason_required: "Gib eine kurze Begründung ein.",
        maintenance_plan_archive_requires_terminated:
          "Der Wartungsplan muss zuerst beendet werden, bevor du ihn archivieren kannst.",
        maintenance_plan_transition_not_allowed:
          "Dieser Statuswechsel ist im aktuellen Zustand nicht möglich.",
      };
      setError(
        messages[result.error] ?? "Der Status konnte nicht geändert werden.",
      );
      return;
    }
    onOpenChange(false);
    router.refresh();
  });
  const title =
    toStatus === "active"
      ? "Wartungsplan aktivieren"
      : toStatus === "suspended"
        ? "Wartungsplan pausieren"
        : toStatus === "terminated"
          ? "Wartungsplan beenden"
          : archived
            ? "Wartungsplan archivieren"
            : "Wartungsplan wiederherstellen";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {plan.planNumber}. Bestehende Fälligkeiten und Revisionen bleiben
            als Verlauf erhalten.
          </DialogDescription>
        </DialogHeader>
        <Field
          label="Begründung"
          htmlFor="maintenance-action-reason"
          required
          error={reasonError}
          className="py-2"
        >
          <Input
            ref={reasonRef}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
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
          <Button
            type="button"
            variant={toStatus === "terminated" ? "destructive" : "default"}
            onClick={() => void run()}
            disabled={isPending}
          >
            {isPending ? "Speichert…" : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
