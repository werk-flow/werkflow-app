'use client';

import { FormDisclosure } from '@/components/ui/form-disclosure';
import { WORK_EXECUTION_LABELS, type WorkLifecycleSnapshot } from '@/lib/work-lifecycle/types';

export function WorkLifecycleGatesAndHistory({ snapshot }: { snapshot: WorkLifecycleSnapshot }) {
  return (
    <FormDisclosure label="Abschlussprüfungen und Verlauf">
      <div className="grid gap-4 pt-3 md:grid-cols-2">
        <div className="space-y-1 text-sm">
          <p>{snapshot.gates.incompleteRequiredInstructions} erforderliche Aufgaben offen</p>
          <p>{snapshot.gates.openCompletionDependencies} Abschlussvoraussetzungen offen</p>
          <p>{snapshot.gates.activeJobClocks} laufende Zeiterfassungen</p>
          <p>{snapshot.gates.incompleteProjectChildren} nicht abgeschlossene Aufträge</p>
          <p>{snapshot.gates.incompleteInstructionEvidence} erforderliche Nachweise offen</p>
          <p>{snapshot.gates.measurementArtifacts} Aufmaße erfasst</p>
          <p>{snapshot.gates.openDefects} offene Mängel</p>
          <p>{snapshot.gates.pendingFormalApprovals} formale Freigaben offen</p>
          <p>{snapshot.gates.requiredCustomerDecisions} erforderliche Kundenentscheidungen offen</p>
          <p>{snapshot.gates.requiredSignatures} erforderliche Unterschriften offen</p>
          <p className="text-muted-foreground">
            {snapshot.gates.notAssessable.length > 0
              ? `${snapshot.gates.notAssessable.length} weitere Prüfpunkte sind noch nicht bewertbar.`
              : 'Alle bekannten Prüfpunkte sind bewertbar.'}
          </p>
        </div>
        <div className="space-y-2">
          {snapshot.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Änderung protokolliert.</p>
          ) : (
            snapshot.history.map((event) => (
              <div key={event.id} className="border-l-2 pl-3 text-sm">
                <p>{event.to_state ? WORK_EXECUTION_LABELS[event.to_state] : 'Automatische Ableitung'}</p>
                <p className="text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat('de-DE', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(event.created_at))}
                  {event.reason ? ` · ${event.reason}` : ''}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </FormDisclosure>
  );
}
