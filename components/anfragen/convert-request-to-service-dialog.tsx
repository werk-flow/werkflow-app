"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useServerAction } from "@/hooks/use-server-action";
import { createServiceCase } from "@/lib/service-cases/actions";

export function ConvertRequestToServiceDialog({
  requestId,
  enabled,
}: {
  requestId: string;
  enabled: boolean;
}): ReactElement | null {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useServerAction(async () => {
    const result = await createServiceCase({
      serviceCaseId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      sourceRequestId: requestId,
      chargeContext: "unknown",
      equipmentIds: [],
    });
    if (!result.success) {
      setError(
        result.error === "service_case_request_customer_site_required"
          ? "Ordne der Anfrage zuerst einen Kunden und Einsatzort zu."
          : result.error === "service_case_request_already_converted"
            ? "Diese Anfrage wurde bereits umgewandelt."
            : "Die Anfrage konnte nicht als Servicefall übernommen werden.",
      );
      return;
    }
    router.push(`/service/faelle/${result.serviceCase.case_number}`);
  });
  if (!enabled) return null;
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Wrench className="size-4" />
        Als Servicefall übernehmen
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anfrage als Servicefall übernehmen?</DialogTitle>
            <DialogDescription>
              Die ursprüngliche Kundenaussage, Dringlichkeit sowie Kunde,
              Ansprechpartner und Einsatzort bleiben erhalten. Die Anfrage kann
              danach nicht nochmals umgewandelt werden.
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Abbrechen</Button>
            <Button type="button" onClick={() => void run()} disabled={isPending}>{isPending ? "Übernimmt…" : "Übernehmen"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
