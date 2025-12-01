'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Loader2, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deleteOrganization } from '@/lib/org/delete-action';

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Du bist nicht angemeldet.',
  org_not_found: 'Organisation nicht gefunden.',
  not_authorized: 'Nur der Admin kann die Organisation löschen.',
  name_mismatch: 'Der eingegebene Name stimmt nicht überein.',
  delete_members_failed: 'Fehler beim Löschen der Mitglieder.',
  delete_invites_failed: 'Fehler beim Löschen der Einladungen.',
  delete_org_failed: 'Fehler beim Löschen der Organisation.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.'
};

interface DeleteOrgDialogProps {
  orgId: string;
  orgName: string;
}

export function DeleteOrgDialog({ orgId, orgName }: DeleteOrgDialogProps) {
  const [open, setOpen] = useState(false);
  const [confirmationName, setConfirmationName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleDelete = async () => {
    setError(null);
    setIsLoading(true);

    try {
      const result = await deleteOrganization(orgId, confirmationName);

      if (result.success) {
        setOpen(false);
        // Redirect based on whether user has remaining organizations
        if (result.nextOrgId) {
          // User has other orgs - go to dashboard with success banner
          window.location.href = `/dashboard?org_deleted=true`;
        } else {
          // User has no orgs - go to onboarding with success banner
          window.location.href = `/onboarding/start?org_deleted=true`;
        }
      } else {
        setError(
          ERROR_MESSAGES[result.error || 'unexpected_error'] ||
            result.error ||
            'Unbekannter Fehler'
        );
      }
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setConfirmationName('');
      setError(null);
    }
  };

  const isNameMatch = confirmationName.trim() === orgName;

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          size="sm"
          className="w-full bg-red-500 text-white hover:bg-red-400 dark:bg-red-500 dark:hover:bg-red-400"
        >
          <Trash2 className="size-4" />
          Organisation löschen
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" />
            Organisation löschen
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-left text-muted-foreground text-sm">
              <span className="font-semibold text-foreground">
                Diese Aktion kann nicht rückgängig gemacht werden.
              </span>{' '}
              Die Organisation wird dauerhaft gelöscht, zusammen mit:
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>Allen Mitgliedschaften</li>
                <li>Allen Einladungen</li>
                <li>Dem Organisationscode</li>
              </ul>
              <p className="mt-3">
                Mitglieder, die nur dieser Organisation angehören, werden zur
                Onboarding-Seite weitergeleitet.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="confirm-name" className="text-sm">
              Gib den Namen der Organisation ein, um zu bestätigen:
            </Label>
            <div className="rounded-md bg-muted px-3 py-2 text-sm font-medium">
              {orgName}
            </div>
            <Input
              id="confirm-name"
              value={confirmationName}
              onChange={(e) => setConfirmationName(e.target.value)}
              placeholder="Organisationsname eingeben"
              disabled={isLoading}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Abbrechen</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isLoading || !isNameMatch}
            className="bg-red-500 text-white hover:bg-red-400 dark:bg-red-500 dark:hover:bg-red-400"
          >
            {isLoading && <Loader2 className="size-4 animate-spin" />}
            {isLoading ? 'Wird gelöscht...' : 'Endgültig löschen'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
