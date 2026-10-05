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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { untilPageLeaves, usePendingTask } from '@/hooks/use-server-action';
import { describeFailure, SHARED_FAILURE_MESSAGES } from '@/lib/action-messages';
import { deleteAccount } from '@/lib/auth/actions';
import { loadDocument } from '@/lib/navigation/document-load';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  has_memberships: 'Du kannst dein Konto nicht löschen, da du Mitglied einer Organisation bist.',
  delete_failed: 'Das Löschen des Kontos ist fehlgeschlagen. Bitte versuche es erneut.',
};

export function DeleteAccountButton() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [isOpen, setIsOpen] = useState(false);
  const { run: runDelete, isPending: isDeleting } = usePendingTask();
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setError(null);

    await runDelete(async () => {
      try {
        const result = await deleteAccount();

        if (!result.success) {
          setError(describeFailure(result.error, ERROR_MESSAGES, SHARED_FAILURE_MESSAGES.unexpected_error));
          return;
        }

        // Sign out locally and load the login page fresh — the deleted account's
        // other sessions are already gone server-side.
        await supabase.auth.signOut({ scope: 'local' });
        loadDocument('/login?message=account_deleted');
        return untilPageLeaves();
      } catch {
        setError(SHARED_FAILURE_MESSAGES.unexpected_error);
      }
    });
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen} pending={isDeleting}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
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
            Bist du sicher, dass du dein Konto löschen möchtest? Diese Aktion kann nicht rückgängig gemacht
            werden. Alle deine Daten werden unwiderruflich gelöscht.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ErrorText>{error}</ErrorText>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={isDeleting}
            variant="destructive"
          >
            {isDeleting ? 'Wird gelöscht…' : 'Konto löschen'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
