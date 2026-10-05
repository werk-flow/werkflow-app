'use client';

import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type PendingApprovalsHeaderProps = {
  isInitialLoading: boolean;
  /** The list could not load: no count, because none is known. */
  loadFailed: boolean;
  itemCount: number;
  sessionCount: number;
  approveAllSessions: () => Promise<void>;
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
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Check className="h-4 w-4" />
                Alle genehmigen
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Alle Zeiteinträge genehmigen?</AlertDialogTitle>
                <AlertDialogDescription>
                  {sessionCount} ausstehende Zeiteinträge werden genehmigt. Änderungsanträge bleiben
                  unberührt.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={() => void approveAllSessions()}>Genehmigen</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <RefreshButton onRefresh={onRefresh} label="Anträge aktualisieren" />
      </div>
    </div>
  );
}
