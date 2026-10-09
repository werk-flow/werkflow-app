'use client';

import { useMemo } from 'react';

import { useBanner } from '@/components/ui/banner';
import type { useLiveAuftraegeData } from '@/hooks/use-live-auftraege-data';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { buildUnifiedList, splitEntries, type Job, type ProjectWithDetails } from '@/lib/jobs/types';
import type { AuftraegeRowFeedback } from './unified-auftraege-entry-list';
import { useAuftraegeCreateActions } from './use-auftraege-create-actions';
import { useAuftraegeLocalUpdates } from './use-auftraege-local-updates';
import { useAuftraegeRowActions } from './use-auftraege-row-actions';

const getEntityId = (entity: { id: string }): string => entity.id;

type AuftraegeOptimisticListOptions = Pick<
  ReturnType<typeof useLiveAuftraegeData>,
  'jobs' | 'projects' | 'setJobs' | 'setRawProjects' | 'setJobAssignmentMap'
> & {
  initialJobs: Job[];
  initialProjects: ProjectWithDetails[];
};

/**
 * The list's own-action layer: the optimistic overlay over the live jobs and
 * projects, the create, edit and delete handlers that drive it, and the
 * sections derived from the merged view.
 */
export function useAuftraegeOptimisticList({
  jobs,
  projects,
  setJobs,
  setRawProjects,
  setJobAssignmentMap,
  initialJobs,
  initialProjects,
}: AuftraegeOptimisticListOptions) {
  // Own-action feedback (feedback canon): a create shows a pending row until
  // the server confirms, a delete removes the row before the server answers,
  // and an edited row stays marked until the refreshed props land.
  const { showBanner } = useBanner();
  const {
    items: jobOverlay,
    insert: insertJob,
    remove: removeJob,
    rollback: rollbackJob,
  } = useOptimisticList({ items: jobs, getId: getEntityId });
  const {
    items: projectOverlay,
    insert: insertProject,
    remove: removeProject,
    rollback: rollbackProject,
  } = useOptimisticList({ items: projects, getId: getEntityId });
  const localUpdates = useAuftraegeLocalUpdates({ setJobs, setRawProjects, setJobAssignmentMap });
  const { settlingIds, ...rowActions } = useAuftraegeRowActions({
    initialJobs,
    initialProjects,
    setJobs,
    showBanner,
    removeJob,
    rollbackJob,
    removeProject,
    rollbackProject,
    handleJobUpsert: localUpdates.handleJobUpsert,
    handleJobDelete: localUpdates.handleJobDelete,
    handleProjectUpsert: localUpdates.handleProjectUpsert,
    handleProjectDelete: localUpdates.handleProjectDelete,
    handleJobAssignmentsReplace: localUpdates.handleJobAssignmentsReplace,
  });
  const createActions = useAuftraegeCreateActions({
    showBanner,
    insertJob,
    rollbackJob,
    insertProject,
    rollbackProject,
    handleJobCreated: localUpdates.handleJobCreated,
    handleProjectCreated: localUpdates.handleProjectCreated,
  });

  const visibleJobs = useMemo(() => jobOverlay.map((entry) => entry.item), [jobOverlay]);
  const visibleProjects = useMemo(() => projectOverlay.map((entry) => entry.item), [projectOverlay]);
  // Creation pickers must follow the same client-owned collection as the
  // table, otherwise a confirmed create remains unselectable until the next
  // route refresh. Pending inserts stay out because their temporary ids are
  // not valid server references.
  const dialogJobs = useMemo(
    () => jobOverlay.filter((entry) => entry.tempId === null).map((entry) => entry.item),
    [jobOverlay],
  );
  const rowFeedback = useMemo<AuftraegeRowFeedback>(
    () => ({
      pendingIds: new Set(
        [...jobOverlay, ...projectOverlay]
          .filter((entry) => entry.isOptimistic)
          .map((entry) => entry.item.id),
      ),
      settlingIds,
    }),
    [jobOverlay, projectOverlay, settlingIds],
  );

  const unifiedEntries = useMemo(
    () => buildUnifiedList(visibleJobs, visibleProjects),
    [visibleJobs, visibleProjects],
  );

  const {
    active: rawActive,
    parked: rawParked,
    archived: rawArchived,
  } = useMemo(() => splitEntries(unifiedEntries), [unifiedEntries]);

  const initialIds = useMemo(
    () => new Set([...initialJobs, ...initialProjects].map((entry) => entry.id)),
    [initialJobs, initialProjects],
  );
  const localPendingIds = useMemo(
    () => new Set([...rowFeedback.pendingIds, ...settlingIds]),
    [rowFeedback.pendingIds, settlingIds],
  );

  return {
    dialogJobs,
    rowFeedback,
    rawActive,
    rawParked,
    rawArchived,
    initialIds,
    localPendingIds,
    ...rowActions,
    ...createActions,
  };
}
