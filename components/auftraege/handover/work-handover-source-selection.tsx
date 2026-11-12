'use client';

import { Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { TextLink } from '@/components/ui/text-link';
import type { WorkHandoverWorkspace } from '@/lib/work-handover/types';
import type { WorkHandoverReview } from './use-work-handover-review';
import type { WorkHandoverActions } from './work-handover-actions';
import { FeedbackText } from './work-handover-feedback';

type WorkHandoverSourceSelectionProps = {
  initialWorkspace: WorkHandoverWorkspace;
  workHref: string;
  review: WorkHandoverReview;
  actions: WorkHandoverActions;
};

/** The empty selection names what the reviewer does first, where. */
function WorkHandoverNextStep({
  targetType,
  href,
}: {
  targetType: WorkHandoverWorkspace['targetType'];
  href: string;
}) {
  return (
    <p className="rounded-md border p-3 text-sm text-muted-foreground">
      Noch nichts zum Übergeben. Gib zuerst{' '}
      {targetType === 'job' ? (
        <>
          im <TextLink href={href}>Auftrag</TextLink> einen Arbeitsnachweis für die Kundendokumentation frei.
        </>
      ) : (
        <>
          im <TextLink href={href}>Projekt</TextLink> einen Arbeitsnachweis für die Kundendokumentation frei
          oder übergib einen seiner Aufträge.
        </>
      )}{' '}
      Danach wählst du ihn hier aus und gibst die Übergabe frei.
    </p>
  );
}

export function WorkHandoverSourceSelection({
  initialWorkspace,
  workHref,
  review,
  actions,
}: WorkHandoverSourceSelectionProps) {
  const { selectedKeySet, setSelectedKeys, setDirty, setPreview, isBusy, anyBusy, feedbackFor } = review;
  const { saveDraft } = actions;
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Inhalte der nächsten Freigabe</h3>
        <p className="text-sm text-muted-foreground">
          Arbeitsnachweise sind intern freigegeben. Dokumente müssen für das Kundenpaket bewusst ausgewählt
          werden.
        </p>
      </div>
      {initialWorkspace.availableSources.length > 0 ? (
        <div className="divide-y rounded-md border">
          {initialWorkspace.availableSources.map((source) => {
            const inputId = `handover-source-${source.key.replace(/[^a-zA-Z0-9]/g, '-')}`;
            return (
              <div key={source.key} className="flex items-start gap-3 p-3">
                <Checkbox
                  id={inputId}
                  checked={selectedKeySet.has(source.key)}
                  onCheckedChange={(checked) => {
                    setSelectedKeys((current) =>
                      checked ? [...current, source.key] : current.filter((key) => key !== source.key),
                    );
                    setDirty(true);
                    setPreview(null);
                  }}
                />
                <Label htmlFor={inputId} className="min-w-0 cursor-pointer font-normal">
                  <span className="block font-medium">{source.label}</span>
                  <span className="block text-muted-foreground">{source.description}</span>
                </Label>
              </div>
            );
          })}
        </div>
      ) : (
        <WorkHandoverNextStep targetType={initialWorkspace.targetType} href={workHref} />
      )}
      {(initialWorkspace.availableSources.length > 0 || initialWorkspace.staleSourceCount > 0) && (
        <Button
          pending={isBusy('draft')}
          type="button"
          variant="outline"
          onClick={saveDraft}
          disabled={anyBusy}
        >
          <Save />
          Entwurf speichern
        </Button>
      )}
      <FeedbackText feedback={feedbackFor('draft')} />
    </div>
  );
}
