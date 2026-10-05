'use client';

import { useId } from 'react';
import { Ban, CheckCircle2, CirclePause, Play, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { SectionError } from '@/components/ui/section-error';
import { InlinePending } from '@/components/ui/inline-pending';
import {
  WORK_EXECUTION_LABELS,
  type WorkBlocker,
  type WorkExecutionState,
  type WorkLifecycleSnapshot,
} from '@/lib/work-lifecycle/types';
import { WORK_EXECUTION_CLASSES } from '../status-classes';

function StateIcon({ state }: { state: WorkExecutionState }) {
  if (state === 'in_progress') return <Play className="size-4" />;
  if (state === 'interrupted') return <CirclePause className="size-4" />;
  if (state === 'cancelled') return <Ban className="size-4" />;
  if (state === 'execution_complete' || state === 'handed_over') return <CheckCircle2 className="size-4" />;
  return <RefreshCw className="size-4" />;
}

type WorkLifecycleStatusHeaderProps = {
  snapshot: WorkLifecycleSnapshot;
  pendingState: WorkExecutionState | null;
  nextAction: string;
  canStart: boolean;
  startReadinessKnown: boolean;
  parking: WorkBlocker | undefined;
  blockingCount: number;
};

export function WorkLifecycleStatusHeader({
  snapshot,
  pendingState,
  nextAction,
  canStart,
  startReadinessKnown,
  parking,
  blockingCount,
}: WorkLifecycleStatusHeaderProps) {
  // Static name: the heading text gains a pending label while saving.
  return (
    <div className="flex flex-wrap items-start justify-between gap-3" role="region" aria-label="Arbeitsstand">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <StateIcon state={snapshot.executionState} />
          Arbeitsstand
          <InlinePending active={pendingState !== null} label="Arbeitsstand wird gespeichert" />
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Nächster Schritt: {nextAction}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary" className={WORK_EXECUTION_CLASSES[snapshot.executionState]}>
          {WORK_EXECUTION_LABELS[snapshot.executionState]}
        </Badge>
        <Badge variant="outline">{snapshot.isPlanned ? 'Geplant' : 'Nicht geplant'}</Badge>
        <Badge variant={startReadinessKnown ? 'secondary' : 'outline'}>
          {snapshot.readinessLoadFailed
            ? 'Startbereitschaft unbekannt'
            : canStart
              ? 'Startbereit'
              : 'Nicht startbereit'}
        </Badge>
        {parking && <Badge variant="secondary">Geparkt</Badge>}
        {blockingCount > 0 && <Badge variant="destructive">{blockingCount} Blocker</Badge>}
        {snapshot.isLegacy && snapshot.targetType === 'job' && (
          <Badge variant="outline">Altbestand · noch ohne Verlauf</Badge>
        )}
        {snapshot.isLegacy && snapshot.targetType === 'project' && (
          <Badge variant="outline">Automatisch abgeleitet</Badge>
        )}
      </div>
    </div>
  );
}

export function WorkLifecycleReadinessSection({
  snapshot,
  onRetry,
  retryPending,
}: {
  snapshot: WorkLifecycleSnapshot;
  onRetry: () => void;
  retryPending: boolean;
}) {
  const titleId = useId();
  return (
    <section className="space-y-2" aria-labelledby={titleId}>
      <h3 id={titleId} className="text-sm font-medium">
        Einsatzbereitschaft
      </h3>
      {snapshot.readinessLoadFailed ? (
        <SectionError onRetry={onRetry} retryPending={retryPending}>
          Die Einsatzbereitschaft konnte nicht geladen werden. Es wird nichts als erfüllt angenommen.
        </SectionError>
      ) : snapshot.readiness ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {snapshot.readiness.dimensions.map((dimension) => (
            <div key={dimension.key} className="rounded-md border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{dimension.label}</span>
                <Badge variant="outline">
                  {dimension.state === 'ok'
                    ? 'Erfüllt'
                    : dimension.state === 'warning'
                      ? 'Prüfen'
                      : 'Nicht bewertet'}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{dimension.details[0]}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Projektweite Einsatzbereitschaft wird aus den einzelnen Aufträgen beurteilt.
        </p>
      )}
    </section>
  );
}
