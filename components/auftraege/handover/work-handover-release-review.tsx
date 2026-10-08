'use client';

import { CheckCircle2, Eye } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import type { WorkHandoverWorkspace } from '@/lib/work-handover/types';
import type { WorkHandoverReview } from './use-work-handover-review';
import type { WorkHandoverActions } from './work-handover-actions';
import { FeedbackText } from './work-handover-feedback';
import { unassessedFacts } from './work-handover-gates';

type WorkHandoverReleaseReviewProps = {
  initialWorkspace: WorkHandoverWorkspace;
  review: WorkHandoverReview;
  actions: WorkHandoverActions;
};

/** Closing checks, exception and handover reasons, preview and release of the saved selection. */
export function WorkHandoverReleaseReview({
  initialWorkspace,
  review,
  actions,
}: WorkHandoverReleaseReviewProps) {
  const {
    activeClocks,
    overrideable,
    warnings,
    attempted,
    overrideReason,
    setOverrideReason,
    reason,
    setReason,
    preview,
    packageVersion,
    canPreview,
    dirty,
    isBusy,
    anyBusy,
    feedbackFor,
  } = review;
  const { releaseErrors, createPreview, release } = actions;
  return (
    <div className="space-y-4 border-t pt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3 text-sm">
          <span className="font-medium">Harte Prüfung</span>
          <p className={activeClocks > 0 ? 'text-destructive' : 'text-muted-foreground'}>
            {activeClocks === 1
              ? 'Eine laufende Zeiterfassung'
              : activeClocks > 1
                ? `${activeClocks} laufende Zeiterfassungen`
                : 'Keine laufende Zeiterfassung'}
          </p>
        </div>
        <div className="rounded-md border p-3 text-sm">
          <span className="font-medium">Prüfpunkte</span>
          <p className="text-muted-foreground">
            {overrideable.length === 0
              ? 'Keine offene Ausnahme'
              : `${overrideable.length} begründbare Ausnahme(n)`}
          </p>
        </div>
      </div>
      {overrideable.length > 0 && (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">
          <p className="font-medium">Offene Prüfpunkte</p>
          <ul className="list-disc space-y-1 pl-5">
            {overrideable.map((gate) => (
              <li key={gate.key}>
                {gate.label}: {gate.count}
              </li>
            ))}
          </ul>
          <Field
            label="Begründung der Ausnahme"
            htmlFor="handover-override-reason"
            required
            error={attempted === 'release' ? releaseErrors['handover-override-reason'] : undefined}
          >
            <Textarea
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
              placeholder="Warum kann die kaufmännische Prüfung trotzdem beginnen?"
            />
          </Field>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-md border p-3 text-sm">
          <p className="font-medium">Hinweise</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      <Field
        label="Übergabevermerk"
        htmlFor="handover-reason"
        required
        error={attempted === 'release' ? releaseErrors['handover-reason'] : undefined}
      >
        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          pending={isBusy('preview')}
          type="button"
          variant="outline"
          onClick={createPreview}
          disabled={anyBusy || !canPreview || activeClocks > 0}
        >
          <Eye />
          Vorschau öffnen
        </Button>
        <Button
          pending={isBusy('release')}
          type="button"
          onClick={release}
          disabled={anyBusy || !preview || preview.packageVersion !== packageVersion || activeClocks > 0}
        >
          <CheckCircle2 />
          Freigeben und übergeben
        </Button>
      </div>
      <FeedbackText feedback={feedbackFor('preview')} />
      {dirty && (
        <p className="text-sm text-muted-foreground">
          Speichere die Auswahl, bevor du die Vorschau erstellst.
        </p>
      )}
      {unassessedFacts(initialWorkspace.gateSnapshot).length > 0 && (
        <p className="text-xs text-muted-foreground">
          Nicht automatisch bewertet: {unassessedFacts(initialWorkspace.gateSnapshot).join(', ')}.
        </p>
      )}
    </div>
  );
}
