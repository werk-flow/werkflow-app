'use client';

import { Plus, Unlink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { WORK_DEPENDENCY_EFFECT_LABELS, type WorkLifecycleSnapshot } from '@/lib/work-lifecycle/types';
import type { WorkLifecycleDialogState } from './work-lifecycle-dialog-state';

type WorkLifecycleDependenciesSectionProps = {
  snapshot: WorkLifecycleSnapshot;
  isManager: boolean;
  rowBusy: { isBusy: (id: string) => boolean };
  setDialog: (dialog: WorkLifecycleDialogState | null) => void;
};

export function WorkLifecycleDependenciesSection({
  snapshot,
  isManager,
  rowBusy,
  setDialog,
}: WorkLifecycleDependenciesSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Voraussetzungen</h3>
        {isManager && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setDialog({ type: 'dependency' })}>
            <Plus className="size-4" />
            Voraussetzung hinzufügen
          </Button>
        )}
      </div>
      {snapshot.dependencies.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine zusätzlichen Voraussetzungen.</p>
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
                <div className="flex items-center gap-1">
                  <InlinePending
                    active={rowBusy.isBusy(dependency.id)}
                    label="Voraussetzung wird aktualisiert"
                  />
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
              )}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
