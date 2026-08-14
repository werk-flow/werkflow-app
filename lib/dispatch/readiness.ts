// Pure readiness composition: a projection over owning-domain facts. Every
// dimension is ok/warning/unknown — there is deliberately no stored aggregate
// "ready" boolean that could drift from its sources. Material demand is never
// a reservation (P1-26) and tools are never assessed here (P1-32).

import type { PlanningConflict } from '@/lib/planning/types';
import type {
  ReadinessDimension,
  ReadinessResult,
  TravelNote,
} from './types';

export type MaterialReadinessFacts =
  | { state: 'no_demand' }
  | {
      state: 'demand';
      lines: Array<{
        itemName: string;
        plannedQuantity: number;
        takenQuantity: number;
        availableQuantity: number;
      }>;
    }
  | { state: 'unknown' };

export type SiteReadinessFacts =
  | { known: true; name: string; accessNotes: string | null }
  // 'missing' = no site is configured; 'load_failed' = the lookup errored.
  // The two must stay distinguishable — a failed read is not "kein Einsatzort".
  | { known: false; reason: 'missing' | 'load_failed' };

export type ReadinessFacts = {
  planningConflicts: PlanningConflict[];
  site: SiteReadinessFacts;
  travelNotes: TravelNote[];
  material: MaterialReadinessFacts;
};

export function composeReadiness(facts: ReadinessFacts): ReadinessResult {
  const capacityConflicts = facts.planningConflicts.filter(
    (conflict) => conflict.kind !== 'qualification'
  );
  const qualificationConflicts = facts.planningConflicts.filter(
    (conflict) => conflict.kind === 'qualification'
  );

  const capacity: ReadinessDimension = {
    key: 'capacity',
    state: capacityConflicts.length > 0 ? 'warning' : 'ok',
    label: 'Kapazität & Verfügbarkeit',
    details: capacityConflicts.map((conflict) => conflict.message),
  };

  const qualification: ReadinessDimension = {
    key: 'qualification',
    state: qualificationConflicts.length > 0 ? 'warning' : 'ok',
    label: 'Qualifikationen',
    details: qualificationConflicts.map((conflict) => conflict.message),
  };

  const site: ReadinessDimension = facts.site.known
    ? {
        key: 'site',
        state: 'ok',
        label: 'Einsatzort',
        details: [
          facts.site.name,
          ...(facts.site.accessNotes ? [facts.site.accessNotes] : []),
        ],
      }
    : {
        key: 'site',
        state: 'unknown',
        label: 'Einsatzort',
        details:
          facts.site.reason === 'load_failed'
            ? ['Einsatzort konnte nicht geladen werden.']
            : ['Kein Einsatzort hinterlegt.'],
      };

  const zeroGapNotes = facts.travelNotes.filter(
    (note) => note.kind === 'no_gap_different_sites'
  );
  const travel: ReadinessDimension = {
    key: 'travel',
    state: zeroGapNotes.length > 0 ? 'warning' : 'unknown',
    label: 'Fahrzeit',
    details:
      zeroGapNotes.length > 0
        ? zeroGapNotes.map(
            (note) =>
              `${note.employeeName}: keine Zeit zwischen „${note.previousTitle}“ und „${note.nextTitle}“ an unterschiedlichen Orten (${note.localDate}).`
          )
        : ['Fahrzeit nicht bewertet.'],
  };

  let material: ReadinessDimension;
  if (facts.material.state === 'no_demand') {
    material = {
      key: 'material',
      state: 'ok',
      label: 'Material',
      details: ['Kein Materialbedarf geplant.'],
    };
  } else if (facts.material.state === 'demand') {
    const shortLines = facts.material.lines.filter(
      (line) =>
        line.availableQuantity <
        Math.max(0, line.plannedQuantity - line.takenQuantity)
    );
    material = {
      key: 'material',
      state: shortLines.length > 0 ? 'warning' : 'ok',
      label: 'Material (nicht reserviert)',
      details: [
        // The open quantity (geplant − entnommen) is the number the warning
        // decision compares against the current stock.
        ...facts.material.lines.map(
          (line) =>
            `${line.itemName}: ${Math.max(0, line.plannedQuantity - line.takenQuantity)} offen von ${line.plannedQuantity} geplant, ${line.availableQuantity} aktuell verfügbar – nicht reserviert.`
        ),
        ...(shortLines.length > 0
          ? ['Der aktuelle Bestand deckt den offenen Bedarf möglicherweise nicht.']
          : []),
      ],
    };
  } else {
    material = {
      key: 'material',
      state: 'unknown',
      label: 'Material',
      details: ['Materialdaten konnten nicht geladen werden.'],
    };
  }

  const tools: ReadinessDimension = {
    key: 'tools',
    state: 'unknown',
    label: 'Werkzeuge',
    details: ['Werkzeugverfügbarkeit nicht bewertet.'],
  };

  const dimensions = [capacity, qualification, site, travel, material, tools];
  return {
    dimensions,
    snapshot: dimensions.map((dimension) => ({
      key: dimension.key,
      state: dimension.state,
      details: dimension.details,
    })),
  };
}
