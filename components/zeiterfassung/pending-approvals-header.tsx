'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import type { PendingSession } from '@/lib/time-tracking/types';

/** The sessions the person confirmed for „Alle genehmigen“, as they saw them when the dialog opened. */
export type ConfirmedSessions = { count: number; entryIds: string[] };

type PendingApprovalsHeaderProps = {
  isInitialLoading: boolean;
  /** The list could not load: no count, because none is known. */
  loadFailed: boolean;
  itemCount: number;
  sessions: readonly PendingSession[];
  /** Approves exactly the confirmed entries; answers the refusal the confirmation shows, or null. */
  approveAllSessions: (confirmed: ConfirmedSessions) => Promise<string | null>;
  onRefresh: () => Promise<void>;
};

// Header with refresh button - always visible
export function PendingApprovalsHeader({
  isInitialLoading,
  loadFailed,
  itemCount,
  sessions,
  approveAllSessions,
  onRefresh,
}: PendingApprovalsHeaderProps) {
  // What the person confirms, taken when the dialog opens. A retry after a refusal sends the same
  // entries even when the list read again meanwhile: it never approves a session nobody confirmed.
  const [confirmed, setConfirmed] = useState<ConfirmedSessions | null>(null);
  return (
    <div className="flex items-center justify-between">
      {/* The skeleton is a <div>: inside a <p> the HTML parser closes the
          paragraph early, and the server markup no longer hydrates (#418). */}
      {isInitialLoading ? (
        <Skeleton className="h-4 w-32" />
      ) : loadFailed ? (
        <span />
      ) : (
        <p className="text-sm text-muted-foreground">
          {itemCount > 0
            ? `${itemCount} ${itemCount === 1 ? 'Antrag' : 'Anträge'} zur Genehmigung`
            : 'Keine ausstehenden Anträge'}
        </p>
      )}
      <div className="flex items-center gap-2">
        {sessions.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setConfirmed({
                count: sessions.length,
                entryIds: sessions.flatMap((session) => session.entryIds),
              })
            }
          >
            <Check className="h-4 w-4" />
            Alle genehmigen
          </Button>
        )}
        {/* Mounted apart from the button: a refusal's read can leave one session, and the
            confirmation must still show why nothing was approved. */}
        <ConfirmActionDialog
          open={confirmed !== null}
          onOpenChange={(open) => !open && setConfirmed(null)}
          title="Alle Zeiteinträge genehmigen?"
          description={`${confirmed?.count ?? 0} ausstehende Zeiteinträge werden genehmigt. Änderungsanträge bleiben unberührt.`}
          confirmLabel="Genehmigen"
          onConfirm={() => (confirmed ? approveAllSessions(confirmed) : Promise.resolve(null))}
        />
        <RefreshButton onRefresh={onRefresh} label="Anträge aktualisieren" />
      </div>
    </div>
  );
}
