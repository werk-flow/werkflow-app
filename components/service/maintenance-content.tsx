'use client';

import { useState, type ReactElement } from 'react';
import { FileCheck2, Plus } from 'lucide-react';

import { useOrganization } from '@/components/organization/organization-context';
import { ListPagination } from '@/components/shared/list-pagination';
import { useBanner } from '@/components/ui/banner';
import { StaleRegion } from '@/components/shared/stale-region';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useListNavigation } from '@/hooks/use-list-navigation';
import { useLiveView } from '@/hooks/use-live-view';
import { readInBackground } from '@/lib/data/background-read-client';
import type { MaintenanceCatalogs, MaintenancePlanItem, MaintenanceWorkspace } from '@/lib/maintenance/types';
import { MAINTENANCE_PAGE_PARAMS, type MaintenanceWorkspaceQuery } from '@/lib/maintenance/workspace-page';
import { MaintenanceCoverageDialog } from './maintenance-coverage-dialog';
import { MaintenanceCoverageDocumentsDialog } from './maintenance-coverage-documents-dialog';
import { MaintenanceCoverageFollowUpDialog } from './maintenance-coverage-follow-up-dialog';
import { MaintenanceDueActionDialog } from './maintenance-due-action-dialog';
import { MaintenanceCoverageList, MaintenanceDueList, type DueAction } from './maintenance-lists';
import { MaintenancePlanActionDialog } from './maintenance-plan-action-dialog';
import { MaintenancePlanCards, type PlanAction } from './maintenance-plan-cards';
import { MaintenancePlanDialog } from './maintenance-plan-dialog';
import { announceSubmission, useMaintenancePendingCreates } from './use-maintenance-pending-creates';

type MaintenanceList = keyof typeof MAINTENANCE_PAGE_PARAMS;

/**
 * The server selects one page of each list: the search, the counts and the
 * page boundaries apply in the database, and the URL owns that state. The
 * typed search stays ahead of the URL while the read is under way; each
 * committed query remounts the results. The chosen tab survives paging.
 */
export function MaintenanceContent({
  initial,
  catalogs,
  query,
}: {
  initial: MaintenanceWorkspace;
  catalogs: MaintenanceCatalogs;
  query: MaintenanceWorkspaceQuery;
}): ReactElement {
  const navigation = useListNavigation();
  const [search, setSearch] = useState(query.search);
  const [tab, setTab] = useState<MaintenanceList>('due');
  const shownSearch = navigation.busy ? search : query.search;

  function changeSearch(value: string): void {
    setSearch(value);
    navigation.navigate(
      {
        q: value,
        [MAINTENANCE_PAGE_PARAMS.due]: null,
        [MAINTENANCE_PAGE_PARAMS.plans]: null,
        [MAINTENANCE_PAGE_PARAMS.coverages]: null,
      },
      250,
    );
  }

  return (
    <>
      <SearchInput
        value={shownSearch}
        onValueChange={changeSearch}
        aria-label="Wartung durchsuchen"
        placeholder="Plan, Kunde, Einsatzort, Auftrag oder Anlage suchen…"
      />
      <MaintenanceWorkspaceView
        key={`${query.search}|${query.duePage}|${query.planPage}|${query.coveragePage}`}
        initial={initial}
        catalogs={catalogs}
        query={query}
        tab={tab}
        onTabChange={setTab}
        busy={navigation.busy}
        onPageChange={(list, page) => navigation.navigate({ [MAINTENANCE_PAGE_PARAMS[list]]: page })}
      />
    </>
  );
}

function isMaintenanceList(value: string): value is MaintenanceList {
  return Object.hasOwn(MAINTENANCE_PAGE_PARAMS, value);
}

/** One committed query: its live read, the three lists with their page controls, and the dialogs. */
function MaintenanceWorkspaceView({
  initial,
  catalogs,
  query,
  tab,
  onTabChange,
  busy,
  onPageChange,
}: {
  initial: MaintenanceWorkspace;
  catalogs: MaintenanceCatalogs;
  query: MaintenanceWorkspaceQuery;
  tab: MaintenanceList;
  onTabChange: (tab: MaintenanceList) => void;
  busy: boolean;
  onPageChange: (list: MaintenanceList, page: number) => void;
}): ReactElement {
  const { activeOrgId } = useOrganization();
  const [coverageDocuments, setCoverageDocuments] = useState<
    MaintenanceWorkspace['coverages'][number] | null
  >(null);
  const [coverageFollowUp, setCoverageFollowUp] = useState<MaintenanceWorkspace['coverages'][number] | null>(
    null,
  );
  const [editPlan, setEditPlan] = useState<MaintenancePlanItem | null>(null);
  const [planAction, setPlanAction] = useState<PlanAction | null>(null);
  const [dueAction, setDueAction] = useState<DueAction | null>(null);
  // Reads over GET, outside the Server Action queue the dialogs' saves use,
  // through the reader of the first render.
  const live = useLiveView({
    tables: ['maintenance_coverages', 'maintenance_plans', 'maintenance_due_work'],
    initialData: initial,
    coalesceWhileReading: true,
    read: async ({ signal }) => {
      if (!activeOrgId) return { ok: false as const };
      const result = await readInBackground(
        'maintenance-workspace',
        { ...query, organizationId: activeOrgId },
        signal,
      );
      return result.success
        ? { ok: true as const, data: result.workspace }
        : { ok: false as const, error: result.error };
    },
  });
  const workspace = live.data ?? initial;
  const { showBanner } = useBanner();
  // Row- and card-scoped settle window after a dialog action: the touched
  // plan or due row shows the indicator until the live read lands.
  const settling = useBusyIds();
  const settleOn = (id: string) => () => void settling.run(id, live.refresh);
  const liveRefresh = live.refresh;
  const liveInvalidate = live.invalidate;
  const { pendingPlans, pendingCoverages } = useMaintenancePendingCreates({
    workspace,
    liveRefresh,
    liveInvalidate,
    showBanner,
  });
  const { totals } = workspace;

  return (
    <>
      <StaleRegion stale={live.isStale} onRetry={live.refresh}>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (isMaintenanceList(value)) onTabChange(value);
          }}
          className="gap-4"
        >
          <TabsList aria-label="Wartungsbereiche">
            <TabsTrigger value="due">
              Fälligkeiten <span className="text-xs text-muted-foreground">{totals.due.total}</span>
            </TabsTrigger>
            <TabsTrigger value="plans">
              Pläne <span className="text-xs text-muted-foreground">{totals.plans.total}</span>
            </TabsTrigger>
            <TabsTrigger value="coverages">
              Abdeckungen <span className="text-xs text-muted-foreground">{totals.coverages.total}</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="due" className="space-y-3">
            <MaintenanceDueList
              openDue={workspace.dueWork}
              hasAnyDue={totals.due.hasAny}
              isBusy={settling.isBusy}
              onDueActionClick={setDueAction}
            />
            <ListPagination
              label="Fälligkeiten"
              page={query.duePage}
              total={totals.due.total}
              busy={busy}
              onPageChange={(page) => onPageChange('due', page)}
            />
          </TabsContent>
          <TabsContent value="plans" className="space-y-3">
            <MaintenancePlanCards
              plans={workspace.plans}
              hasAnyPlan={totals.plans.hasAny}
              pendingPlans={pendingPlans}
              isBusy={settling.isBusy}
              onEditClick={setEditPlan}
              onActionClick={setPlanAction}
            />
            <ListPagination
              label="Wartungspläne"
              page={query.planPage}
              total={totals.plans.total}
              busy={busy}
              onPageChange={(page) => onPageChange('plans', page)}
            />
          </TabsContent>
          <TabsContent value="coverages" className="space-y-3">
            <MaintenanceCoverageList
              coverages={workspace.coverages}
              hasAnyCoverage={totals.coverages.hasAny}
              pendingCoverages={pendingCoverages}
              onFollowUpClick={setCoverageFollowUp}
              onDocumentsClick={setCoverageDocuments}
            />
            <ListPagination
              label="Abdeckungen"
              page={query.coveragePage}
              total={totals.coverages.total}
              busy={busy}
              onPageChange={(page) => onPageChange('coverages', page)}
            />
          </TabsContent>
        </Tabs>
      </StaleRegion>
      {coverageDocuments && (
        <MaintenanceCoverageDocumentsDialog
          open
          onOpenChange={(open) => {
            if (!open) setCoverageDocuments(null);
          }}
          coverage={coverageDocuments}
        />
      )}
      {coverageFollowUp && (
        <MaintenanceCoverageFollowUpDialog
          open
          onOpenChange={(open) => {
            if (!open) setCoverageFollowUp(null);
          }}
          coverage={coverageFollowUp}
          currentActorId={workspace.currentActorId}
          owners={catalogs.followUpOwners}
        />
      )}
      {editPlan && (
        <MaintenancePlanDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditPlan(null);
          }}
          templates={catalogs.templates}
          initial={editPlan}
          onSaved={settleOn(editPlan.id)}
        />
      )}
      {planAction && (
        <MaintenancePlanActionDialog
          open
          onOpenChange={(open) => {
            if (!open) setPlanAction(null);
          }}
          {...planAction}
          onSaved={settleOn(planAction.plan.id)}
        />
      )}
      {dueAction && (
        <MaintenanceDueActionDialog
          open
          onOpenChange={(open) => {
            if (!open) setDueAction(null);
          }}
          due={dueAction.due}
          defaultAction={dueAction.defaultAction}
          plannedDurationMinutes={dueAction.due.plannedDurationMinutes}
          onSaved={settleOn(dueAction.due.id)}
        />
      )}
    </>
  );
}

/** The toolbar actions; the page renders them beside the h2, ahead of the workspace. */
export function MaintenanceCreateButtons({
  templates,
}: Pick<MaintenanceCatalogs, 'templates'>): ReactElement {
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [coverageDialogOpen, setCoverageDialogOpen] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" onClick={() => setCoverageDialogOpen(true)}>
        <FileCheck2 className="size-4" />
        Abdeckung erfassen
      </Button>
      <Button type="button" onClick={() => setPlanDialogOpen(true)}>
        <Plus className="size-4" />
        Wartungsplan anlegen
      </Button>
      {planDialogOpen && (
        <MaintenancePlanDialog
          open
          onOpenChange={setPlanDialogOpen}
          templates={templates}
          onSubmitted={announceSubmission}
        />
      )}
      {coverageDialogOpen && (
        <MaintenanceCoverageDialog
          open
          onOpenChange={setCoverageDialogOpen}
          onSubmitted={announceSubmission}
        />
      )}
    </div>
  );
}
