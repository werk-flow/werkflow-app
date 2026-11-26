'use client';
import { ErrorText } from '@/components/ui/error-text';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import { useFurtherOrganizationCheckout } from './further-organization-checkout';

interface CreateOrgDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** An organization the caller administers; the server checks the role again. */
  adminOrganizationId: string;
}

export function CreateOrgDialog({ open, onOpenChange, adminOrganizationId }: CreateOrgDialogProps) {
  const { start, isPending, error, clearError } = useFurtherOrganizationCheckout(adminOrganizationId);

  const handleStart = async (event: React.FormEvent) => {
    event.preventDefault();
    await start();
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) clearError();
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} pending={isPending}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neue Organisation erstellen</DialogTitle>
          <DialogDescription>Jede Organisation hat ihr eigenes monatliches Abo.</DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void handleStart(event)} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Du schließt das Abo über Stripe ab, per SEPA-Lastschrift oder Karte. Den Preis siehst du vor dem
            Abschluss. Danach gibst du der Organisation einen Namen und wirst ihr Admin.
          </p>

          <ErrorText>{error}</ErrorText>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Abbrechen
            </Button>
            <Button type="submit" pending={isPending}>
              {isPending ? 'Wird geöffnet…' : 'Weiter zur Zahlung'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
