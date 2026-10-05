import type { WorkHandoverWorkspace } from '@/lib/work-handover/types';

export const OVERRIDEABLE_GATES: Array<[string, string]> = [
  ['incompleteRequiredInstructions', 'Pflichtanweisungen offen'],
  ['reopenedInstructionPredecessors', 'Vorgänger erneut offen'],
  ['incompleteInstructionEvidence', 'Pflichtnachweise fehlen'],
  ['openBlockers', 'Blocker offen'],
  ['openCompletionDependencies', 'Abschlussvoraussetzungen offen'],
  ['incompleteProjectChildren', 'Untergeordnete Aufträge nicht abgeschlossen'],
  ['incompleteChildHandovers', 'Untergeordnete Übergaben fehlen'],
  ['openDefects', 'Mängel offen'],
  ['pendingFormalApprovals', 'Freigaben ausstehend'],
  ['requiredCustomerDecisions', 'Kundenentscheidung ausstehend'],
  ['requiredSignatures', 'Unterschrift ausstehend'],
];

export const WARNING_GATES: Array<[string, string]> = [
  ['missingOptionalPhotos', 'Keine optionalen Fotos ausgewählt oder verknüpft'],
  ['missingDispatchContext', 'Kein Einsatzauftrag vorhanden'],
  ['missingTimeContext', 'Keine Zeitbuchung vorhanden'],
  ['missingMaterialContext', 'Kein Materialkontext vorhanden'],
];

const UNASSESSED_FACT_LABELS = {
  time_segment_completeness: 'Vollständigkeit der Zeitsegmente',
  material_consumption: 'Materialverbrauch',
  tool_custody: 'Werkzeugverbleib',
  measurements: 'Vollständigkeit der Aufmaße',
  customer_decision: 'Kundenentscheidung',
  signature: 'Unterschrift',
  billability: 'Abrechenbarkeit',
  invoice_readiness: 'Rechnungsreife',
} satisfies Record<string, string>;
const UNASSESSED_FACT_LABEL_BY_CODE: Record<string, string> = UNASSESSED_FACT_LABELS;

export function gateCount(snapshot: WorkHandoverWorkspace['gateSnapshot'], key: string): number {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return 0;
  const value = snapshot[key];
  return typeof value === 'number' ? value : 0;
}

export function unassessedFacts(snapshot: WorkHandoverWorkspace['gateSnapshot']): string[] {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return [];
  const value = snapshot.notAssessable;
  return Array.isArray(value)
    ? value.flatMap((entry) =>
        typeof entry === 'string' && UNASSESSED_FACT_LABEL_BY_CODE[entry]
          ? [UNASSESSED_FACT_LABEL_BY_CODE[entry]]
          : [],
      )
    : [];
}
