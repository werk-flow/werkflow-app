'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';

type PendingApprovalsHeaderProps = {
  isInitialLoading: boolean;
  /** The list could not load: no count, because none is known. */
  loadFailed: boolean;
  itemCount: number;
  sessionCount: number;
  /** Answers the refusal the confirmation shows, or null once every session is approved. */
  approveAllSessions: () => Promise<string | null>;
  onRefresh: () => Promise<void>;
};

// Header with refresh button - always visible
export function PendingApprovalsHeader({
  isInitialLoading,
  loadFailed,
  itemCount,
  sessionCount,
  approveAllSessions,
  onRefresh,
}: PendingApprovalsHeaderProps) {
  // The count the person confirms: it stays as asked while the list reads again.
  const [confirmedCount, setConfirmedCount] = useState<number | null>(null);
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
        {sessionCount > 1 && (
          <Button variant="outline" size="sm" onClick={() => setConfirmedCount(sessionCount)}>
            <Check className="h-4 w-4" />
            Alle genehmigen
          </Button>
        )}
        {/* Mounted apart from the button: a refusal's read can leave one session, and the
            confirmation must still show why nothing was approved. */}
        <ConfirmActionDialog
          open={confirmedCount !== null}
          onOpenChange={(open) => !open && setConfirmedCount(null)}
          title="Alle Zeiteinträge genehmigen?"
          description={`${confirmedCount ?? 0} ausstehende Zeiteinträge werden genehmigt. Änderungsanträge bleiben unberührt.`}
          confirmLabel="Genehmigen"
          onConfirm={approveAllSessions}
        />
        <RefreshButton onRefresh={onRefresh} label="Anträge aktualisieren" />
      </div>
    </div>
  );
}
