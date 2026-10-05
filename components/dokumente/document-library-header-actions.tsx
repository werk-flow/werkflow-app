'use client';

import type { RefObject } from 'react';
import { Folder, FolderPlus, Plus, Upload } from 'lucide-react';

import { PageHeaderActions } from '@/components/shared/page-action';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type DocumentLibraryHeaderActionsProps = {
  showMenu: boolean;
  menuDisabled: boolean;
  canCreateFolder: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  folderInputRef: RefObject<HTMLInputElement | null>;
  onCreateFolder: () => void;
  onFilesChosen: (files: FileList | null) => void;
  onFolderChosen: (files: FileList | null) => void;
};

/** „Hochladen oder Erstellen" in the page header, with the hidden file and folder inputs it opens. */
export function DocumentLibraryHeaderActions({
  showMenu,
  menuDisabled,
  canCreateFolder,
  fileInputRef,
  folderInputRef,
  onCreateFolder,
  onFilesChosen,
  onFolderChosen,
}: DocumentLibraryHeaderActionsProps) {
  return (
    <>
      <PageHeaderActions>
        {showMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" disabled={menuDisabled}>
                <Plus className="size-4" />
                Hochladen oder Erstellen
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {canCreateFolder && (
                <>
                  <DropdownMenuItem onClick={onCreateFolder}>
                    <FolderPlus className="size-4" />
                    Neuer Ordner
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <Upload className="size-4" />
                Dateien hochladen
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => folderInputRef.current?.click()}>
                <Folder className="size-4" />
                Ordner hochladen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </PageHeaderActions>
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => onFolderChosen(event.target.files)}
        {...{ webkitdirectory: '', directory: '' }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => onFilesChosen(event.target.files)}
      />
    </>
  );
}
