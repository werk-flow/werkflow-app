'use client';

import { Plus, Unlink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { InlinePending } from '@/components/ui/inline-pending';
import {
  WORK_DEPENDENCY_EFFECT_LABELS,
  type WorkDependency,
  type WorkLifecycleSnapshot,
} from '@/lib/work-lifecycle/types';
import type { WorkLifecycleDialogState } from './work-lifecycle-dialog-state';

type WorkLifecycleDependenciesSectionProps = {
  snapshot: WorkLifecycleSnapshot;
  isManager: boolean;
  rowBusy: { isBusy: (id: string) => boolean };
  setDialog: (dialog: WorkLifecycleDialogState | null) => void;
};

/** Link an approval, mark a declared condition met or open, or remove the dependency. */
function DependencyRowActions({
  dependency,
  rowBusy,
  setDialog,
}: {
  dependency: WorkDependency;
  rowBusy: WorkLifecycleDependenciesSectionProps['rowBusy'];
  setDialog: WorkLifecycleDependenciesSectionProps['setDialog'];
}) {
  return (
    <div className="flex items-center gap-1">
      <InlinePending active={rowBusy.isBusy(dependency.id)} label="Voraussetzung wird aktualisiert" />
      {dependency.declared_kind === 'approval' &&
      !dependency.artifact_approval_action_id &&
      !dependency.is_satisfied ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={rowBusy.isBusy(dependency.id)}
          onClick={() => setDialog({ type: 'artifact-approval-dependency', dependency })}
        >
          Freigabe verknüpfen
        </Button>
      ) : (
        dependency.declared_kind && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={rowBusy.isBusy(dependency.id)}
            onClick={() =>
              setDialog({
                type: 'dependency-state',
                dependency,
                state: dependency.is_satisfied ? 'open' : 'satisfied',
              })
            }
          >
            {dependency.is_satisfied ? 'Wieder öffnen' : 'Erfüllt'}
          </Button>
        )
      )}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Voraussetzung entfernen"
        disabled={rowBusy.isBusy(dependency.id)}
        onClick={() => setDialog({ type: 'remove-dependency', dependency })}
      >
        <Unlink className="size-4" />
      </Button>
    </div>
  );
}

export function WorkLifecycleDependenciesSection({
  snapshot,
  isManager,
  rowBusy,
  setDialog,
}: WorkLifecycleDependenciesSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <h3 className="text-sm font-medium">Voraussetzungen</h3>
        {isManager && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setDialog({ type: 'dependency' })}>
            <Plus className="size-4" />
            Voraussetzung hinzufügen
          </Button>
        )}
      </div>
      {snapshot.dependencies.length === 0 ? (
        <EmptyState size="compact" title="Keine zusätzlichen Voraussetzungen." />
      ) : (
        snapshot.dependencies.map((dependency) => (
          <div
            key={dependency.id}
            data-testid="work-dependency-row"
            className="rounded-md border p-3 text-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{dependency.description || 'Verknüpfte Arbeit'}</p>
                <p className="text-muted-foreground">
                  {WORK_DEPENDENCY_EFFECT_LABELS[dependency.effect]} ·{' '}
                  {dependency.is_satisfied ? 'erfüllt' : 'offen'}
                </p>
              </div>
              {isManager && (
                <DependencyRowActions dependency={dependency} rowBusy={rowBusy} setDialog={setDialog} />
              )}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
