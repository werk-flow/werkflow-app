'use client';

import { normalizeSearchText } from '@/lib/ui/search';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { BriefcaseBusiness, FolderKanban, LinkIcon, Loader2, UserRound, Users, Wrench } from 'lucide-react';

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
import { updateDocumentLinks } from '@/lib/documents/actions';
import type { OrganizationDocument } from '@/lib/documents/types';
import type { JobEntityOption } from '@/lib/jobs/option-types';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { useServerAction } from '@/hooks/use-server-action';

import { DocumentLinkTargetList } from './document-link-target-list';
import { useDocumentLinkEmployees } from './use-document-link-employees';

type LinkTargetType = 'job' | 'project' | 'client' | 'employee' | 'equipment';
type LinkKey = 'jobId' | 'projectId' | 'clientId' | 'employeeId' | 'equipmentId';

const TARGETS: ReadonlyArray<{
  type: LinkTargetType;
  linkKey: LinkKey;
  tab: string;
  noun: string;
  searchPlaceholder: string;
  icon: typeof Wrench;
}> = [
  {
    type: 'job',
    linkKey: 'jobId',
    tab: 'Aufträge',
    noun: 'Auftrag',
    searchPlaceholder: 'Auftrag suchen…',
    icon: BriefcaseBusiness,
  },
  {
    type: 'project',
    linkKey: 'projectId',
    tab: 'Projekte',
    noun: 'Projekt',
    searchPlaceholder: 'Projekt suchen…',
    icon: FolderKanban,
  },
  {
    type: 'client',
    linkKey: 'clientId',
    tab: 'Kunden',
    noun: 'Kunde',
    searchPlaceholder: 'Kunde suchen…',
    icon: Users,
  },
  {
    type: 'employee',
    linkKey: 'employeeId',
    tab: 'Mitarbeiter',
    noun: 'Mitarbeiter',
    searchPlaceholder: 'Mitarbeiter suchen…',
    icon: UserRound,
  },
  {
    type: 'equipment',
    linkKey: 'equipmentId',
    tab: 'Anlagen',
    noun: 'Anlage',
    searchPlaceholder: 'Anlage suchen…',
    icon: Wrench,
  },
];

type DocumentLinkDialogProps = {
  document: OrganizationDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (variant: 'success' | 'error', message: string) => void;
};

function getLinkedIds(document: OrganizationDocument | null, linkKey: LinkKey): string[] {
  return [
    ...new Set(
      document?.links.flatMap((link) => {
        const id = link[linkKey];
        return id ? [id] : [];
      }) ?? [],
    ),
  ];
}

function jobOptionLabel(option: JobEntityOption): string {
  return option.description ? `${option.description} · ${option.label}` : option.label;
}

function formatLinkCount(count: number): string {
  return count === 1 ? '1 Verknüpfung' : `${count} Verknüpfungen`;
}

function formatChangeCount(count: number): string {
  return count === 1 ? '1 Änderung' : `${count} Änderungen`;
}

function getUpdateMessage(result: {
  success: boolean;
  addedCount?: number;
  removedCount?: number;
  error?: string;
}): { variant: 'success' | 'error'; message: string } {
  const addedCount = result.addedCount ?? 0;
  const removedCount = result.removedCount ?? 0;

  if (result.success) {
    if (addedCount === 0 && removedCount === 0) {
      return { variant: 'success', message: 'Keine Änderungen vorgenommen.' };
    }
    if (addedCount > 0 && removedCount > 0) {
      return {
        variant: 'success',
        message: `${formatLinkCount(addedCount)} hinzugefügt, ${formatLinkCount(removedCount)} entfernt.`,
      };
    }
    if (addedCount > 0) {
      return {
        variant: 'success',
        message:
          addedCount === 1
            ? 'Verknüpfung wurde hinzugefügt.'
            : `${addedCount} Verknüpfungen wurden hinzugefügt.`,
      };
    }
    return {
      variant: 'success',
      message:
        removedCount === 1 ? 'Verknüpfung wurde entfernt.' : `${removedCount} Verknüpfungen wurden entfernt.`,
    };
  }

  // The save is all or nothing: a failure changed no link.
  return {
    variant: 'error',
    message: 'Die Verknüpfungen konnten nicht aktualisiert werden.',
  };
}

function collectRemovedLinkIds(
  document: OrganizationDocument | null,
  selected: Record<LinkTargetType, Set<string>>,
): string[] {
  return (
    document?.links
      .filter((link) =>
        TARGETS.some(({ type, linkKey }) => {
          const id = link[linkKey];
          return id ? !selected[type].has(id) : false;
        }),
      )
      .map((link) => link.id) ?? []
  );
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
            <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
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
  const { run: runSaveLinks, isPending: isSaving } = useServerAction(updateDocumentLinks);
  const [targetType, setTargetType] = useState<LinkTargetType>('job');
  const [searchQuery, setSearchQuery] = useState('');
  // Both failures render inside the dialog (feedback canon: the error sits at
  // the point of action and the dialog never closes on failure).
  const [saveError, setSaveError] = useState<string | null>(null);
  const linked = useMemo(
    () => ({
      job: getLinkedIds(document, 'jobId'),
      project: getLinkedIds(document, 'projectId'),
      client: getLinkedIds(document, 'clientId'),
      employee: getLinkedIds(document, 'employeeId'),
      equipment: getLinkedIds(document, 'equipmentId'),
    }),
    [document],
  );
  const [selected, setSelected] = useState<Record<LinkTargetType, Set<string>>>(() => ({
    job: new Set(linked.job),
    project: new Set(linked.project),
    client: new Set(linked.client),
    employee: new Set(linked.employee),
    equipment: new Set(linked.equipment),
  }));
  // A choice made under an earlier search stays listed after the search changes.
  const [picked, setPicked] = useState<Map<string, JobEntityOption>>(() => new Map());

  // Each list is one bounded page of the organization plus the linked records;
  // the server searches the rest. Staff is the one complete, small list.
  const jobSearch = useJobEntityOptions({ kind: 'jobs' }, linked.job);
  const projectSearch = useJobEntityOptions({ kind: 'projects' }, linked.project);
  const clientSearch = useJobEntityOptions({ kind: 'clients' }, linked.client);
  const equipmentSearch = useJobEntityOptions({ kind: 'equipment' }, linked.equipment);
  const { employees, employeesFailed, isLoadingEmployees, needsEmployees, retryEmployees } =
    useDocumentLinkEmployees(open && !!document);

  const searches = {
    job: jobSearch,
    project: projectSearch,
    client: clientSearch,
    equipment: equipmentSearch,
  };
  const activeSearch = targetType === 'employee' ? null : searches[targetType];
  const { onSearchChange: searchActive } = activeSearch ?? {};
  // The first page of a tab loads when the tab is shown.
  const isShown = open && !!document;
  useEffect(() => {
    if (isShown) searchActive?.('');
  }, [isShown, targetType, searchActive]);

  const normalizedSearchQuery = normalizeSearchText(searchQuery);
  const options: JobEntityOption[] = activeSearch
    ? activeSearch.options.map((option) =>
        targetType === 'job' ? { ...option, label: jobOptionLabel(option) } : option,
      )
    : (employees ?? []).filter((employee) =>
        employee.label.toLocaleLowerCase('de-DE').includes(normalizedSearchQuery),
      );
  const listedIds = new Set(options.map((option) => option.value));
  const visibleTargets = [
    ...options,
    ...[...selected[targetType]].flatMap((id) => {
      const option = listedIds.has(id) ? undefined : picked.get(id);
      return option ? [option] : [];
    }),
  ];
  const listError = activeSearch
    ? activeSearch.loadError
    : employeesFailed
      ? 'Die Mitarbeiter konnten nicht geladen werden.'
      : undefined;
  const isLoadingList =
    visibleTargets.length === 0 &&
    (activeSearch ? activeSearch.loading : isLoadingEmployees || needsEmployees);

  const additions = (type: LinkTargetType) => [...selected[type]].filter((id) => !linked[type].includes(id));
  const removeLinkIds = collectRemovedLinkIds(document, selected);
  const changeCount = TARGETS.reduce(
    (count, { type }) => count + additions(type).length,
    removeLinkIds.length,
  );
  const selectedCount = TARGETS.reduce((count, { type }) => count + selected[type].size, 0);

  function handleTargetTypeChange(nextTargetType: LinkTargetType) {
    setTargetType(nextTargetType);
    setSearchQuery('');
  }

  function toggle(option: JobEntityOption) {
    setPicked((current) => new Map(current).set(option.value, option));
    setSelected((current) => {
      const next = new Set(current[targetType]);
      if (!next.delete(option.value)) next.add(option.value);
      return { ...current, [targetType]: next };
    });
  }

  function handleSave() {
    if (!document || changeCount === 0) return;
    setSaveError(null);

    void (async () => {
      let result: Awaited<ReturnType<typeof updateDocumentLinks>>;
      try {
        result = await runSaveLinks({
          documentId: document.id,
          addJobIds: additions('job'),
          addProjectIds: additions('project'),
          addClientIds: additions('client'),
          addEmployeeIds: additions('employee'),
          addEquipmentIds: additions('equipment'),
          removeLinkIds,
        });
      } catch {
        setSaveError('Die Verknüpfungen konnten nicht aktualisiert werden.');
        return;
      }

      const feedback = getUpdateMessage(result);
      if (!result.success) {
        setSaveError(feedback.message);
        return;
      }

      onComplete(feedback.variant, feedback.message);
      onOpenChange(false);
    })();
  }

  const activeTarget = TARGETS.find((target) => target.type === targetType) ?? TARGETS[0];
  const ActiveIcon = activeTarget?.icon ?? Wrench;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isSaving}>
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
            targetType={targetType}
            selected={selected}
            onTargetTypeChange={handleTargetTypeChange}
          />

          <DocumentLinkSearchField
            value={searchQuery}
            placeholder={activeTarget?.searchPlaceholder}
            isSearching={Boolean(activeSearch?.loading) && visibleTargets.length > 0}
            onChange={(value) => {
              setSearchQuery(value);
              activeSearch?.onSearchChange(value);
            }}
          />

          <DocumentLinkTargetList
            listError={listError}
            onRetryList={() => (activeSearch ? activeSearch.onSearchChange(searchQuery) : retryEmployees())}
            isLoadingList={isLoadingList}
            visibleTargets={visibleTargets}
            selectedIds={selected[targetType]}
            linkedIds={linked[targetType]}
            onToggle={toggle}
            ActiveIcon={ActiveIcon}
            noun={activeTarget?.noun}
            activeSearch={activeSearch}
          />

          <ErrorText>{saveError}</ErrorText>
        </div>

        <DialogFooter>
          <p className="mr-auto text-sm text-muted-foreground">
            {selectedCount} verknüpft
            {changeCount > 0 ? ` · ${formatChangeCount(changeCount)}` : ''}
          </p>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Abbrechen
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving || changeCount === 0}>
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : <LinkIcon className="size-4" />}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
