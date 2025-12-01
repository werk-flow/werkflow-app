'use client';

import { useState, useMemo } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { deleteAccount } from '@/lib/auth/actions';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Du bist nicht angemeldet.',
  has_memberships:
    'Du kannst dein Konto nicht löschen, da du Mitglied einer Organisation bist.',
  database_error:
    'Ein Datenbankfehler ist aufgetreten. Bitte versuche es erneut.',
  delete_failed:
    'Das Löschen des Kontos ist fehlgeschlagen. Bitte versuche es erneut.'
};

export function DeleteAccountButton() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);

    try {
      const result = await deleteAccount();

      if (!result.success) {
        setError(ERROR_MESSAGES[result.error] || 'Ein Fehler ist aufgetreten.');
        setIsDeleting(false);
        return;
      }

      // Sign out locally and redirect to login
      await supabase.auth.signOut();
      window.location.href = '/login?message=account_deleted';
    } catch (err) {
      console.error('Error deleting account:', err);
      setError('Ein unerwarteter Fehler ist aufgetreten.');
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="mr-2 size-4" />
          Konto löschen
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="size-5 text-destructive" />
            </div>
            <AlertDialogTitle>Konto löschen?</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="pt-2">
            Bist du sicher, dass du dein Konto löschen möchtest? Diese Aktion
            kann nicht rückgängig gemacht werden. Alle deine Daten werden
            unwiderruflich gelöscht.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Wird gelöscht...' : 'Konto löschen'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
