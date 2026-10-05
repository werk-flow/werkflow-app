'use client';

import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { FOLDER_NAME_INPUT_ID, type DocumentFolderCreation } from './use-document-folder-creation';
import type { DocumentRename } from './use-document-rename';

/** The library's two one-field name forms: rename an entry, create a folder. */

export function DocumentRenameDialog({ rename }: { rename: DocumentRename }) {
  const { renameDialog } = rename;
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renameDialog) return;
    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [renameDialog]);

  return (
    <Dialog
      open={!!renameDialog}
      onOpenChange={rename.handleRenameOpenChange}
      pending={rename.isRenamePending}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {renameDialog?.kind === 'folder' ? 'Ordner umbenennen' : 'Datei umbenennen'}
          </DialogTitle>
          <DialogDescription>
            Vergib einen klaren Namen, damit das Dokument später leicht gefunden wird.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            rename.handleRenameConfirm();
          }}
          noValidate
          className="space-y-4"
        >
          <Field
            label={renameDialog?.kind === 'folder' ? 'Ordnername' : 'Dateiname'}
            hideLabel
            error={rename.renameError}
          >
            <Input
              ref={renameInputRef}
              value={rename.renameValue}
              onChange={(event) => rename.setRenameValue(event.target.value)}
              placeholder="Name"
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={rename.cancelRename}
              disabled={rename.isRenamePending}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={rename.isRenamePending}>
              {rename.isRenamePending && <Loader2 className="size-4 animate-spin" />}
              Umbenennen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentCreateFolderDialog({ folderCreation }: { folderCreation: DocumentFolderCreation }) {
  return (
    <Dialog
      open={folderCreation.folderDialogOpen}
      onOpenChange={folderCreation.handleFolderDialogOpenChange}
      pending={folderCreation.isCreatePending}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ordner erstellen</DialogTitle>
          <DialogDescription>Lege einen neuen Ordner im aktuellen Bereich an.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            folderCreation.handleCreateFolder();
          }}
          noValidate
          className="space-y-4"
        >
          <Field
            label="Ordnername"
            htmlFor={FOLDER_NAME_INPUT_ID}
            hideLabel
            error={folderCreation.folderError}
          >
            <Input
              value={folderCreation.folderName}
              onChange={(event) => folderCreation.setFolderName(event.target.value)}
              placeholder="Ordnername"
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={folderCreation.cancelFolderDialog}
              disabled={folderCreation.isCreatePending}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={folderCreation.isCreatePending}>
              {folderCreation.isCreatePending && <Loader2 className="size-4 animate-spin" />}
              Erstellen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
