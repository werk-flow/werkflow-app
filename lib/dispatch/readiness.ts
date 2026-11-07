// Pure readiness composition: a projection over owning-domain facts. Every
// dimension is ok/warning/unknown — there is deliberately no stored aggregate
// "ready" boolean that could drift from its sources. Material demand is never
// a reservation (P1-26) and tools are never assessed here (P1-32).

import type { PlanningConflict } from '@/lib/planning/types';
import { formatGermanDate } from '@/lib/utils';
import type { ReadinessDimension, ReadinessResult, TravelNote, UnplannedReason } from './types';

/**
 * The two readiness chips a calendar card carries while material is not
 * reserved and tools are not assessed: the wording has one home here, beside
 * the dimensions the Einsätze dialog renders in full.
 */
export const MATERIAL_UNRESERVED_LABEL = 'Material nicht reserviert';

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

/**
 * The planning assessment of the visit readiness looks at. Capacity and
 * qualifications cannot be met by nobody on no day, so a target without a
 * visit or without people on it stays unassessed and names what is missing.
 */
export type PlanningReadinessFacts =
  | { state: 'assessed'; localDate: string; conflicts: PlanningConflict[] }
  | { state: UnplannedReason }
  // A field worker's view: the visit's people and their absences stay with the office.
  | { state: 'office_only' };

export type ReadinessFacts = {
  planning: PlanningReadinessFacts;
  site: SiteReadinessFacts;
  travelNotes: TravelNote[];
  material: MaterialReadinessFacts;
};

function materialDimension(facts: MaterialReadinessFacts): ReadinessDimension {
  if (facts.state === 'no_demand') {
    return {
      key: 'material',
      state: 'ok',
      label: 'Material',
      details: ['Kein Materialbedarf geplant.'],
    };
  }
  if (facts.state === 'demand') {
    const shortLines = facts.lines.filter(
      (line) => line.availableQuantity < Math.max(0, line.plannedQuantity - line.takenQuantity),
    );
    return {
      key: 'material',
      state: shortLines.length > 0 ? 'warning' : 'ok',
      label: 'Material (nicht reserviert)',
      details: [
        // The open quantity (geplant − entnommen) is the number the warning
        // decision compares against the current stock.
        ...facts.lines.map(
          (line) =>
            `${line.itemName}: ${Math.max(0, line.plannedQuantity - line.takenQuantity)} offen von ${line.plannedQuantity} geplant, ${line.availableQuantity} aktuell verfügbar – nicht reserviert.`,
        ),
        ...(shortLines.length > 0
          ? ['Der aktuelle Bestand deckt den offenen Bedarf möglicherweise nicht.']
          : []),
      ],
    };
  }
  return {
    key: 'material',
    state: 'unknown',
    label: 'Material',
    details: ['Materialdaten konnten nicht geladen werden.'],
  };
}

const UNASSESSED_DETAILS: Record<UnplannedReason | 'office_only', string> = {
  no_visit: 'Kein Termin geplant.',
  no_assignees: 'Niemand zugewiesen.',
  office_only: 'Prüft das Büro bei der Einplanung.',
};

function conflictDetail(conflict: PlanningConflict): string {
  return conflict.employeeName ? `${conflict.employeeName}: ${conflict.message}` : conflict.message;
}

/** Capacity or qualifications of the planned visit, or what is missing to assess them. */
function planningDimension(
  key: 'capacity' | 'qualification',
  label: string,
  planning: PlanningReadinessFacts,
): ReadinessDimension {
  if (planning.state !== 'assessed') {
    return { key, state: 'unknown', label, details: [UNASSESSED_DETAILS[planning.state]] };
  }
  const conflicts = planning.conflicts.filter(
    (conflict) => (conflict.kind === 'qualification') === (key === 'qualification'),
  );
  return conflicts.length > 0
    ? { key, state: 'warning', label, details: conflicts.map(conflictDetail) }
    : {
        key,
        state: 'ok',
        label,
        details: [`Keine Konflikte am ${formatGermanDate(planning.localDate)}.`],
      };
}

export function composeReadiness(facts: ReadinessFacts): ReadinessResult {
  const capacity = planningDimension('capacity', 'Kapazität & Verfügbarkeit', facts.planning);
  const qualification = planningDimension('qualification', 'Qualifikationen', facts.planning);

  const site: ReadinessDimension = facts.site.known
    ? {
        key: 'site',
        state: 'ok',
        label: 'Einsatzort',
        details: [facts.site.name, ...(facts.site.accessNotes ? [facts.site.accessNotes] : [])],
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

  const zeroGapNotes = facts.travelNotes.filter((note) => note.kind === 'no_gap_different_sites');
  const travel: ReadinessDimension = {
    key: 'travel',
    state: zeroGapNotes.length > 0 ? 'warning' : 'unknown',
    label: 'Fahrzeit',
    details:
      zeroGapNotes.length > 0
        ? zeroGapNotes.map(
            (note) =>
              `${note.employeeName}: keine Zeit zwischen „${note.previousTitle}“ und „${note.nextTitle}“ an unterschiedlichen Orten (${note.localDate}).`,
          )
        : ['Fahrzeit nicht bewertet.'],
  };

  const material = materialDimension(facts.material);

  const tools: ReadinessDimension = {
    key: 'tools',
    state: 'unknown',
    label: 'Werkzeuge',
    details: ['Werkzeugverfügbarkeit nicht bewertet.'],
  };

  const dimensions = [capacity, qualification, site, travel, material, tools];
  return {
    dimensions,
    unplannedReason:
      facts.planning.state === 'no_visit' || facts.planning.state === 'no_assignees'
        ? facts.planning.state
        : null,
    snapshot: dimensions.map((dimension) => ({
      key: dimension.key,
      state: dimension.state,
      details: dimension.details,
    })),
  };
}
