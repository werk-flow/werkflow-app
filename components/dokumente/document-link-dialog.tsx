'use client';

import { type ReactElement } from 'react';
import { LinkIcon, Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { SearchInput } from '@/components/ui/search-input';

import {
  TARGETS,
  useDocumentLinkDialogState,
  type DocumentLinkDialogProps,
  type LinkTargetType,
} from './document-link-dialog-state';
import { DocumentLinkTargetList } from './document-link-target-list';

function formatChangeCount(count: number): string {
  return count === 1 ? '1 Änderung' : `${count} Änderungen`;
}

function DocumentLinkTargetTabs({
  targetType,
  selected,
  onTargetTypeChange,
}: {
  targetType: LinkTargetType;
  selected: Record<LinkTargetType, Set<string>>;
  onTargetTypeChange: (nextTargetType: LinkTargetType) => void;
}): ReactElement {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
      {TARGETS.map(({ type, tab, icon: Icon }) => (
        <Button
          key={type}
          type="button"
          variant={targetType === type ? 'secondary' : 'outline'}
          onClick={() => onTargetTypeChange(type)}
        >
          <Icon className="size-4" />
          {tab}
          {selected[type].size > 0 && (
            <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground">
              {selected[type].size}
            </span>
          )}
        </Button>
      ))}
    </div>
  );
}
function DocumentLinkSearchField({
  value,
  placeholder,
  isSearching,
  onChange,
}: {
  value: string;
  placeholder: string | undefined;
  isSearching: boolean;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <SearchInput
      value={value}
      onValueChange={onChange}
      placeholder={placeholder}
      aria-label={placeholder ?? 'Suchen'}
      pending={isSearching}
    />
  );
}
export function DocumentLinkDialog({
  document,
  open,
  onOpenChange,
  onComplete,
}: DocumentLinkDialogProps): ReactElement {
  const dialog = useDocumentLinkDialogState({ document, open, onOpenChange, onComplete });

  const activeTarget = TARGETS.find((target) => target.type === dialog.targetType) ?? TARGETS[0];
  const ActiveIcon = activeTarget?.icon ?? Wrench;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={dialog.isSaving}>
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle>Verknüpfungen verwalten</DialogTitle>
          <DialogDescription>
            Wähle Aufträge, Projekte, Kunden, Mitarbeiter und Anlagen für „{document?.displayName}“.
            Abgewählte bestehende Verknüpfungen werden entfernt.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <DocumentLinkTargetTabs
            targetType={dialog.targetType}
            selected={dialog.selected}
            onTargetTypeChange={dialog.handleTargetTypeChange}
          />

          <DocumentLinkSearchField
            value={dialog.searchQuery}
            placeholder={activeTarget?.searchPlaceholder}
            isSearching={Boolean(dialog.activeSearch?.loading) && dialog.visibleTargets.length > 0}
            onChange={(value) => {
              dialog.setSearchQuery(value);
              dialog.activeSearch?.onSearchChange(value);
            }}
          />

          <DocumentLinkTargetList
            listFailure={dialog.listFailure}
            isLoadingList={dialog.isLoadingList}
            visibleTargets={dialog.visibleTargets}
            selectedIds={dialog.selected[dialog.targetType]}
            linkedIds={dialog.linked[dialog.targetType]}
            onToggle={dialog.toggle}
            ActiveIcon={ActiveIcon}
            noun={activeTarget?.noun}
            activeSearch={dialog.activeSearch}
          />

          <ErrorText>{dialog.saveError}</ErrorText>
        </div>

        <DialogFooter>
          <p className="mr-auto text-sm text-muted-foreground">
            {dialog.selectedCount} verknüpft
            {dialog.changeCount > 0 ? ` · ${formatChangeCount(dialog.changeCount)}` : ''}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={dialog.isSaving}
          >
            Abbrechen
          </Button>
          <Button
            pending={dialog.isSaving}
            type="button"
            onClick={dialog.handleSave}
            disabled={dialog.isSaving || !dialog.isDirty}
          >
            <LinkIcon className="size-4" />
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
