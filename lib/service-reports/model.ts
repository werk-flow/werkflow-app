import type { MaintenanceScopeOutcome } from '@/lib/maintenance/types';

// The Servicebericht of one completed maintenance visit, as the customer
// receives it (werk-flow/werkflow-planning#471). Every field is customer-safe:
// the type has no place for an internal note, a completion reason, triage,
// coverage, an owner, a price or a cost, and `model.test.ts` fails when one
// is added. The reader selects only these facts; the builder maps them.

type PostalParty = { name: string; addressLines: string[] };

type ServiceReportEquipment = {
  name: string;
  equipmentNumber: string;
  /** Hersteller and Modell, for example `Vaillant ecoTEC plus`; null when neither is recorded. */
  makeAndModel: string | null;
  /** Where the Anlage stands inside the site, for example `Keller`. */
  location: string | null;
};

type ServiceReportReading = {
  description: string;
  location: string | null;
  /** Quantity and unit as printed, for example `2,5 m`. */
  value: string;
};

export type ServiceReport = {
  /** The day the report was created, `YYYY-MM-DD`; it dates the PDF. */
  issuedOn: string;
  /** The day of the visit, `YYYY-MM-DD`. */
  visitedOn: string;
  jobNumber: string | null;
  recipient: PostalParty;
  site: PostalParty | null;
  equipment: ServiceReportEquipment[];
  outcome: MaintenanceScopeOutcome;
  /** The performed work of each customer-facing evidence revision, one paragraph each. */
  workDone: string[];
  readings: ServiceReportReading[];
  openDefects: string[];
  /** What follows an unfinished visit, in words for the customer; null for a finished one. */
  nextStep: string | null;
  /** The customer's signature on a customer-facing evidence revision, with its Berlin day `YYYY-MM-DD`. */
  signature: { signerName: string; signedOn: string } | null;
};
