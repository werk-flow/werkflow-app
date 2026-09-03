"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ManualEntryDialog } from "@/components/manual-entry-dialog";
import { useClockState } from "@/components/clock-state-provider";
import {
  MANUAL_ENTRY_CREATED_EVENT,
  queueManualEntryBridge,
} from "@/lib/time-tracking/manual-entry-bridge";

/** The overview's toolbar action: opens the manual entry dialog and refreshes the live clock afterwards. */
export function ManualEntryButton() {
  const router = useRouter();
  const { refresh } = useClockState();

  return (
    <ManualEntryDialog
      onSuccess={async (entries) => {
        if (typeof window !== "undefined") {
          queueManualEntryBridge(entries);
          window.dispatchEvent(
            new CustomEvent(MANUAL_ENTRY_CREATED_EVENT, {
              detail: { entries },
            }),
          );
        }
        await refresh();
        router.refresh();
      }}
      trigger={
        <Button size="default" className="gap-2">
          <Plus className="size-4" />
          <span>Manuelle Eintragung</span>
        </Button>
      }
    />
  );
}
