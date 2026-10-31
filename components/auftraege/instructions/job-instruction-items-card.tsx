'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { ClipboardList } from 'lucide-react';

import { useBanner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { useBusyIds } from '@/hooks/use-busy-id';
import type {
  InstructionListOwner,
  JobInstructionActor,
  JobInstructionItemWithDetails,
} from '@/lib/jobs/types';
import { JobInstructionDraftRow } from './job-instruction-draft-row';
import { InstructionItemDetailsDialog } from './job-instruction-item-details-dialog';
import { JobInstructionItemRow } from './job-instruction-item-row';
import { createJobInstructionRowActions, type JobInstructionRowActions } from './job-instruction-row-actions';
import { useJobInstructionDraft } from './use-job-instruction-draft';
import { useJobInstructionItemEditing } from './use-job-instruction-item-editing';
import { useJobInstructionItemList, type RenderedInstructionItem } from './use-job-instruction-item-list';
import { SectionTitle } from '@/components/shared/section-title';

type JobInstructionItemsCardProps = InstructionListOwner & {
  initialItems: JobInstructionItemWithDetails[];
  isAdminOrManager: boolean;
  currentUserActor: JobInstructionActor | null;
  refreshSignal?: number;
  readOnly?: boolean;
};

export function JobInstructionItemsCard({
  jobId,
  projectId,
  initialItems,
  isAdminOrManager,
  currentUserActor,
  refreshSignal = 0,
  readOnly = false,
}: JobInstructionItemsCardProps): ReactElement {
  const [detailsItem, setDetailsItem] = useState<JobInstructionItemWithDetails | null>(null);
  const { showBanner } = useBanner();
  // One busy set for every row mutation (toggle, edit, delete, reorder, and
  // the optimistic create row): the spinner sits on the affected row and the
  // other rows stay usable.
  const busy = useBusyIds();
  const owner: InstructionListOwner = projectId !== undefined ? { projectId } : { jobId };

  function showErrorBanner(message: string) {
    showBanner({ variant: 'error', message });
  }

  const itemList = useJobInstructionItemList({
    owner,
    initialItems,
    refreshSignal,
  });
  const { items, replaceItem } = itemList;
  const draftState = useJobInstructionDraft({
    owner,
    isAdminOrManager,
    currentUserActor,
    itemList,
    runOnRow: busy.run,
    showErrorBanner,
  });
  const { draft } = draftState;
  const editing = useJobInstructionItemEditing({
    itemList,
    runOnRow: busy.run,
    isBusy: busy.isBusy,
    showErrorBanner,
  });
  const rowActions = createJobInstructionRowActions({
    owner,
    currentUserActor,
    itemList,
    busy,
    showErrorBanner,
  });

  const displayedItems = useMemo(() => displayedInstructionEntries(items, draft), [draft, items]);

  return (
    <>
      <div className="min-w-0 w-full overflow-hidden rounded-lg border bg-card p-4 sm:p-5">
        <JobInstructionItemsCardHeader isAdminOrManager={isAdminOrManager} readOnly={readOnly} />

        <JobInstructionItemsCardRows
          displayedItems={displayedItems}
          items={items}
          isAdminOrManager={isAdminOrManager}
          readOnly={readOnly}
          isBusy={busy.isBusy}
          draftState={draftState}
          editing={editing}
          rowActions={rowActions}
          setDetailsItem={setDetailsItem}
        />
      </div>
      <InstructionItemDetailsDialog
        key={detailsItem?.id ?? 'closed'}
        item={detailsItem}
        allItems={items}
        onClose={() => setDetailsItem(null)}
        onSaved={(item) => {
          replaceItem(item);
          setDetailsItem(null);
          showBanner({ variant: 'success', message: 'Eintragsdetails gespeichert.' });
        }}
      />
    </>
  );
}

function JobInstructionItemsCardHeader({
  isAdminOrManager,
  readOnly,
}: {
  isAdminOrManager: boolean;
  readOnly: boolean;
}): ReactElement {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <SectionTitle icon={<ClipboardList className="size-4" />}>
          Arbeitsanweisungen &amp; Notizen
        </SectionTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdminOrManager
            ? 'Erfasse Anweisungen direkt als Checkliste. Mit Enter entsteht der nächste Punkt.'
            : readOnly
              ? 'Die Arbeit ist abgeschlossen. Die Aufgaben bleiben als Verlauf sichtbar.'
              : 'Du kannst die Punkte lesen und als erledigt oder offen markieren.'}
        </p>
      </div>
    </div>
  );
}

type JobInstructionDraftState = ReturnType<typeof useJobInstructionDraft>;

type DisplayedInstructionEntry =
  | { type: 'item'; item: RenderedInstructionItem }
  | { type: 'draft'; draft: NonNullable<JobInstructionDraftState['draft']> };

type JobInstructionItemsCardRowsProps = {
  displayedItems: DisplayedInstructionEntry[];
  items: RenderedInstructionItem[];
  isAdminOrManager: boolean;
  readOnly: boolean;
  isBusy: (id: string) => boolean;
  draftState: JobInstructionDraftState;
  editing: ReturnType<typeof useJobInstructionItemEditing>;
  rowActions: JobInstructionRowActions;
  setDetailsItem: (item: JobInstructionItemWithDetails) => void;
};

function displayedInstructionEntries(
  items: RenderedInstructionItem[],
  draft: JobInstructionDraftState['draft'],
): DisplayedInstructionEntry[] {
  if (!draft) {
    return items.map((item) => ({ type: 'item' as const, item }));
  }
  return [...items.map((item) => ({ type: 'item' as const, item })), { type: 'draft' as const, draft }];
}

/** The saved rows in order, followed by a manager's draft row; a viewer without rows sees the empty state. */
function JobInstructionItemsCardRows({
  displayedItems,
  items,
  isAdminOrManager,
  readOnly,
  isBusy,
  draftState,
  editing,
  rowActions,
  setDetailsItem,
}: JobInstructionItemsCardRowsProps): ReactElement {
  if (!isAdminOrManager && items.length === 0) {
    return (
      <EmptyState
        size="compact"
        title="Noch keine Arbeitsanweisungen vorhanden."
        description="Sobald im Büro oder von einem Admin Punkte angelegt werden, erscheinen sie hier."
      />
    );
  }
  return (
    <div className="space-y-3">
      {displayedItems.map((entry) => {
        if (entry.type === 'draft') {
          return (
            <JobInstructionDraftRow
              key={entry.draft.draftId}
              draft={entry.draft}
              items={items}
              setDraft={draftState.setDraft}
              draftTextareaRef={draftState.draftTextareaRef}
              handleCreateDraft={draftState.handleCreateDraft}
            />
          );
        }

        return (
          <JobInstructionItemRow
            key={entry.item.id}
            item={entry.item}
            items={items}
            isAdminOrManager={isAdminOrManager}
            readOnly={readOnly}
            isBusy={isBusy}
            editing={editing}
            rowActions={rowActions}
            focusDraft={draftState.focusDraft}
            setDetailsItem={setDetailsItem}
          />
        );
      })}
    </div>
  );
}
