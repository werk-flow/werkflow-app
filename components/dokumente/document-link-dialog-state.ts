'use client';

import { normalizeSearchText } from '@/lib/ui/search';
import { useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, FolderKanban, UserRound, Users, Wrench } from 'lucide-react';

import { updateDocumentLinks } from '@/lib/documents/actions';
import type { OrganizationDocument, UpdateDocumentLinksResult } from '@/lib/documents/types';
import type { JobEntityOption } from '@/lib/jobs/option-types';
import { useJobEntityOptions, type JobEntityOptionsState } from '@/hooks/use-job-entity-options';
import { useServerAction } from '@/hooks/use-server-action';

import { useDocumentLinkEmployees } from './use-document-link-employees';

export type LinkTargetType = 'job' | 'project' | 'client' | 'employee' | 'equipment';
type LinkKey = 'jobId' | 'projectId' | 'clientId' | 'employeeId' | 'equipmentId';

export const TARGETS: ReadonlyArray<{
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

export type DocumentLinkDialogProps = {
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
function getUpdateMessage(result: UpdateDocumentLinksResult): {
  variant: 'success' | 'error';
  message: string;
} {
  const addedCount = result.success ? result.addedCount : 0;
  const removedCount = result.success ? result.removedCount : 0;

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

type LinkSelection = Record<LinkTargetType, Set<string>>;

function useDocumentLinkSelection(document: OrganizationDocument | null, targetType: LinkTargetType) {
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
  const [selected, setSelected] = useState<LinkSelection>(() => ({
    job: new Set(linked.job),
    project: new Set(linked.project),
    client: new Set(linked.client),
    employee: new Set(linked.employee),
    equipment: new Set(linked.equipment),
  }));
  // A choice made under an earlier search stays listed after the search changes.
  const [picked, setPicked] = useState<Map<string, JobEntityOption>>(() => new Map());

  function toggle(option: JobEntityOption) {
    setPicked((current) => new Map(current).set(option.value, option));
    setSelected((current) => {
      const next = new Set(current[targetType]);
      if (!next.delete(option.value)) next.add(option.value);
      return { ...current, [targetType]: next };
    });
  }

  return { linked, selected, picked, toggle };
}

type LinkedIds = ReturnType<typeof useDocumentLinkSelection>['linked'];

type DocumentLinkSearchesInput = {
  document: OrganizationDocument | null;
  open: boolean;
  linked: LinkedIds;
  targetType: LinkTargetType;
};

function useDocumentLinkSearches({ document, open, linked, targetType }: DocumentLinkSearchesInput) {
  // Each list is one bounded page of the organization plus the linked records;
  // the server searches the rest. Staff is the one complete, small list.
  const jobSearch = useJobEntityOptions({ kind: 'jobs' }, linked.job);
  const projectSearch = useJobEntityOptions({ kind: 'projects' }, linked.project);
  const clientSearch = useJobEntityOptions({ kind: 'clients' }, linked.client);
  const equipmentSearch = useJobEntityOptions({ kind: 'equipment' }, linked.equipment);
  const { employees, isLoadingEmployees, employeesFailure } = useDocumentLinkEmployees(open && !!document);

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

  return { activeSearch, employees, isLoadingEmployees, employeesFailure };
}

type VisibleTargetsInput = {
  activeSearch: JobEntityOptionsState | null;
  employees: JobEntityOption[] | null;
  targetType: LinkTargetType;
  searchQuery: string;
  selected: LinkSelection;
  picked: Map<string, JobEntityOption>;
};

function listVisibleTargets({
  activeSearch,
  employees,
  targetType,
  searchQuery,
  selected,
  picked,
}: VisibleTargetsInput): JobEntityOption[] {
  const normalizedSearchQuery = normalizeSearchText(searchQuery);
  const options: JobEntityOption[] = activeSearch
    ? activeSearch.options.map((option) =>
        targetType === 'job' ? { ...option, label: jobOptionLabel(option) } : option,
      )
    : (employees ?? []).filter((employee) =>
        employee.label.toLocaleLowerCase('de-DE').includes(normalizedSearchQuery),
      );
  const listedIds = new Set(options.map((option) => option.value));
  return [
    ...options,
    ...[...selected[targetType]].flatMap((id) => {
      const option = listedIds.has(id) ? undefined : picked.get(id);
      return option ? [option] : [];
    }),
  ];
}

function summarizeLinkChanges(
  document: OrganizationDocument | null,
  linked: LinkedIds,
  selected: LinkSelection,
) {
  const additions = (type: LinkTargetType) => [...selected[type]].filter((id) => !linked[type].includes(id));
  const removeLinkIds = collectRemovedLinkIds(document, selected);
  const changeCount = TARGETS.reduce(
    (count, { type }) => count + additions(type).length,
    removeLinkIds.length,
  );
  const selectedCount = TARGETS.reduce((count, { type }) => count + selected[type].size, 0);
  return { additions, removeLinkIds, changeCount, selectedCount };
}

function linkUpdateInput(
  documentId: string,
  additions: (type: LinkTargetType) => string[],
  removeLinkIds: string[],
) {
  return {
    documentId,
    addJobIds: additions('job'),
    addProjectIds: additions('project'),
    addClientIds: additions('client'),
    addEmployeeIds: additions('employee'),
    addEquipmentIds: additions('equipment'),
    removeLinkIds,
  };
}

export function useDocumentLinkDialogState({
  document,
  open,
  onOpenChange,
  onComplete,
}: DocumentLinkDialogProps) {
  const { run: runSaveLinks, isPending: isSaving } = useServerAction(updateDocumentLinks);
  const [targetType, setTargetType] = useState<LinkTargetType>('job');
  const [searchQuery, setSearchQuery] = useState('');
  // Both failures render inside the dialog (feedback canon: the error sits at
  // the point of action and the dialog never closes on failure).
  const [saveError, setSaveError] = useState<string | null>(null);
  const { linked, selected, picked, toggle } = useDocumentLinkSelection(document, targetType);
  const { activeSearch, employees, isLoadingEmployees, employeesFailure } = useDocumentLinkSearches({
    document,
    open,
    linked,
    targetType,
  });
  const visibleTargets = listVisibleTargets({
    activeSearch,
    employees,
    targetType,
    searchQuery,
    selected,
    picked,
  });
  const listFailure = activeSearch ? activeSearch.loadFailure : employeesFailure;
  const isLoadingList =
    visibleTargets.length === 0 && (activeSearch ? activeSearch.loading : isLoadingEmployees);
  const { additions, removeLinkIds, changeCount, selectedCount } = summarizeLinkChanges(
    document,
    linked,
    selected,
  );
  const isDirty = changeCount > 0;

  function handleTargetTypeChange(nextTargetType: LinkTargetType) {
    setTargetType(nextTargetType);
    setSearchQuery('');
  }

  function handleSave() {
    if (!document || !isDirty) return;
    setSaveError(null);

    void (async () => {
      let result: Awaited<ReturnType<typeof updateDocumentLinks>>;
      try {
        result = await runSaveLinks(linkUpdateInput(document.id, additions, removeLinkIds));
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

  return {
    isSaving,
    targetType,
    searchQuery,
    setSearchQuery,
    saveError,
    linked,
    selected,
    toggle,
    activeSearch,
    visibleTargets,
    listFailure,
    isLoadingList,
    changeCount,
    isDirty,
    selectedCount,
    handleTargetTypeChange,
    handleSave,
  };
}
