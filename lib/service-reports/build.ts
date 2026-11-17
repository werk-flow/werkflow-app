import type { MaintenanceNextAction, MaintenanceScopeOutcome } from '@/lib/maintenance/types';
import type { WorkArtifactMeasurementUnit, WorkArtifactVisibility } from '@/lib/work-artifacts/types';
import { WORK_ARTIFACT_UNIT_LABELS } from '@/lib/work-artifacts/types';
import { formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { formatGermanDate } from '@/lib/utils';

import type { ServiceReport } from './model';

// Builds the Servicebericht from what the reader selected. The source holds
// customer-safe columns only; the builder still leaves out every internal
// evidence revision, and turns the next action into customer text without its
// owner or its internal reason.

type EvidenceSource = {
  visibility: WorkArtifactVisibility;
  performedWork: string | null;
  readings: Array<{
    description: string;
    location: string | null;
    quantity: number;
    unit: WorkArtifactMeasurementUnit;
  }>;
  signature: { signerName: string; signedAt: string } | null;
};

export type ServiceReportSource = {
  issuedOn: string;
  completedOn: string;
  scopeOutcome: MaintenanceScopeOutcome;
  jobNumber: string | null;
  recipient: { name: string; address: string | null };
  site: { name: string; street: string | null; postalCode: string | null; city: string | null } | null;
  equipment: Array<{
    name: string;
    equipmentNumber: string;
    manufacturer: string | null;
    model: string | null;
    locationDetail: string | null;
  }>;
  /** The visit's evidence revisions in the order they were linked. */
  evidence: EvidenceSource[];
  /** Mängel and next action of a partial or unresolved visit. */
  finding: { defects: string[]; nextAction: MaintenanceNextAction; targetDate: string | null } | null;
};

const quantityFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 });

const nonBlank = (values: Array<string | null>): string[] =>
  values.flatMap((value) => (value?.trim() ? [value.trim()] : []));

/** A customer's free-text address as lines: one per line break, else one per comma. */
function customerAddressLines(address: string | null): string[] {
  const text = address?.trim() ?? '';
  return nonBlank(text.split(text.includes('\n') ? /\r?\n/ : ','));
}

/** The next action as the customer reads it; the target date, never its owner or internal reason. */
function nextStepText(finding: ServiceReportSource['finding']): string | null {
  if (!finding) return null;
  const by = finding.targetDate ? ` bis ${formatGermanDate(finding.targetDate)}` : '';
  switch (finding.nextAction) {
    case 'return_visit':
      return `Für die offenen Mängel ist ein weiterer Besuch${by} geplant.`;
    case 'warranty_check':
      return `Wir klären${by} mit dem Hersteller, wie die offenen Mängel behoben werden.`;
    case 'offer_replacement':
      return `Ein Angebot für den Austausch folgt${by}.`;
    case 'none':
      return 'Weitere Arbeiten sind derzeit nicht geplant.';
  }
}

export function buildServiceReport(source: ServiceReportSource): ServiceReport {
  const shown = source.evidence.filter((revision) => revision.visibility === 'customer_facing');
  const signature = shown.find((revision) => revision.signature)?.signature ?? null;
  const { site } = source;
  return {
    issuedOn: source.issuedOn,
    visitedOn: source.completedOn,
    jobNumber: source.jobNumber,
    recipient: { name: source.recipient.name, addressLines: customerAddressLines(source.recipient.address) },
    site: site && {
      name: site.name,
      addressLines: nonBlank([site.street, nonBlank([site.postalCode, site.city]).join(' ')]),
    },
    equipment: source.equipment.map((item) => ({
      name: item.name,
      equipmentNumber: item.equipmentNumber,
      makeAndModel: nonBlank([item.manufacturer, item.model]).join(' ') || null,
      location: item.locationDetail?.trim() || null,
    })),
    outcome: source.scopeOutcome,
    workDone: nonBlank(shown.map((revision) => revision.performedWork)),
    readings: shown.flatMap((revision) =>
      revision.readings.map((reading) => ({
        description: reading.description,
        location: reading.location?.trim() || null,
        value: `${quantityFormat.format(reading.quantity)} ${WORK_ARTIFACT_UNIT_LABELS[reading.unit]}`,
      })),
    ),
    openDefects: source.finding?.defects ?? [],
    nextStep: nextStepText(source.finding),
    signature: signature && {
      signerName: signature.signerName,
      signedOn: formatBerlinLocalDate(signature.signedAt),
    },
  };
}
