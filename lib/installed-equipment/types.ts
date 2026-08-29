import type { Database, Json } from "@/lib/supabase/database.types";

export const EQUIPMENT_CATEGORIES = [
  "heat_generation",
  "storage_and_hot_water",
  "ventilation",
  "solar_thermal",
  "water_and_sanitary_system",
  "system_component",
  "other",
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const EQUIPMENT_STATES = [
  "unknown",
  "active",
  "inactive",
  "removed",
  "replaced",
  "decommissioned",
] as const;
export type EquipmentState = (typeof EQUIPMENT_STATES)[number];

export const EQUIPMENT_IDENTIFIER_TYPES = [
  "serial_number",
  "manufacturer_product_number",
  "operator_equipment_number",
  "other",
] as const;
export type EquipmentIdentifierType =
  (typeof EQUIPMENT_IDENTIFIER_TYPES)[number];

export const EQUIPMENT_SUBTYPES = [
  "heat_pump",
  "gas_boiler",
  "oil_boiler",
  "biomass_boiler",
  "district_heat_interface",
  "combined_heat_power",
  "electric_heat_generator",
  "other_heat_generator",
  "domestic_hot_water_storage",
  "buffer_storage",
  "combined_storage",
  "fresh_water_station",
  "instantaneous_water_heater",
  "domestic_hot_water_heat_pump",
  "other_storage_or_hot_water",
  "central_ventilation_with_heat_recovery",
  "decentral_ventilation_with_heat_recovery",
  "exhaust_air_ventilation",
  "other_ventilation",
  "water_treatment",
  "pressure_boosting",
  "wastewater_lifting",
  "other_water_or_sanitary",
  "indoor_unit",
  "outdoor_unit",
  "burner",
  "pump",
  "controller_or_gateway",
  "collector",
  "other_component",
] as const;
export type EquipmentSubtype = (typeof EQUIPMENT_SUBTYPES)[number];

export const EQUIPMENT_CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  heat_generation: "Wärmeerzeugung",
  storage_and_hot_water: "Speicher & Warmwasser",
  ventilation: "Lüftung",
  solar_thermal: "Solarthermie",
  water_and_sanitary_system: "Wasser & Sanitär",
  system_component: "Anlagenkomponente",
  other: "Sonstiges",
};

export const EQUIPMENT_STATE_LABELS: Record<EquipmentState, string> = {
  unknown: "Unbekannt",
  active: "Aktiv",
  inactive: "Vorübergehend außer Betrieb",
  removed: "Entfernt",
  replaced: "Ersetzt",
  decommissioned: "Stillgelegt",
};

const EQUIPMENT_MUTATION_ERROR_MESSAGES: Record<string, string> = {
  installed_equipment_initial_state_invalid:
    "Der Startzustand muss „Unbekannt“, „Aktiv“ oder „Vorübergehend außer Betrieb“ sein.",
  installed_equipment_source_target_invalid:
    "Der gewählte Herkunftsnachweis gehört nicht zu dieser Anlage.",
  installed_equipment_replacement_cycle:
    "Die Ersatzbeziehung würde einen ungültigen Kreislauf bilden.",
  installed_equipment_document_version_invalid:
    "Die gewählte Dokumentversion ist nicht mehr verfügbar.",
  installed_equipment_document_link_not_found:
    "Die Dokumentverknüpfung wurde nicht gefunden oder bereits entfernt.",
  installed_equipment_stale_version:
    "Die Anlage wurde inzwischen geändert. Bitte lade die Seite neu.",
  installed_equipment_voided:
    "Dieser irrtümlich erfasste Nachfolger kann nicht mehr geändert werden.",
};

export function getEquipmentMutationErrorMessage(
  error: string | undefined,
  fallback: string,
): string {
  return (error && EQUIPMENT_MUTATION_ERROR_MESSAGES[error]) || fallback;
}

export function getAllowedEquipmentTransitions(
  state: EquipmentState,
): EquipmentState[] {
  if (state === "unknown")
    return ["active", "inactive", "removed", "decommissioned"];
  if (state === "active") return ["inactive", "removed", "decommissioned"];
  if (state === "inactive") return ["active", "removed", "decommissioned"];
  if (state === "removed") return ["active"];
  return [];
}

export const EQUIPMENT_IDENTIFIER_TYPE_LABELS: Record<
  EquipmentIdentifierType,
  string
> = {
  serial_number: "Seriennummer",
  manufacturer_product_number: "Hersteller- oder Artikelnummer",
  operator_equipment_number: "Betreiberkennung",
  other: "Weitere Kennung",
};

export const EQUIPMENT_SUBTYPE_LABELS: Record<EquipmentSubtype, string> = {
  heat_pump: "Wärmepumpe",
  gas_boiler: "Gasgerät",
  oil_boiler: "Ölgerät",
  biomass_boiler: "Biomasseanlage",
  district_heat_interface: "Fernwärmeübergabe",
  combined_heat_power: "Blockheizkraftwerk",
  electric_heat_generator: "Elektrischer Wärmeerzeuger",
  other_heat_generator: "Sonstiger Wärmeerzeuger",
  domestic_hot_water_storage: "Trinkwarmwasserspeicher",
  buffer_storage: "Pufferspeicher",
  combined_storage: "Kombispeicher",
  fresh_water_station: "Frischwasserstation",
  instantaneous_water_heater: "Durchlauferhitzer",
  domestic_hot_water_heat_pump: "Warmwasser-Wärmepumpe",
  other_storage_or_hot_water: "Sonstiger Speicher oder Warmwasserbereiter",
  central_ventilation_with_heat_recovery:
    "Zentrale Lüftung mit Wärmerückgewinnung",
  decentral_ventilation_with_heat_recovery:
    "Dezentrale Lüftung mit Wärmerückgewinnung",
  exhaust_air_ventilation: "Abluftanlage",
  other_ventilation: "Sonstige Lüftungsanlage",
  water_treatment: "Wasseraufbereitung",
  pressure_boosting: "Druckerhöhung",
  wastewater_lifting: "Abwasserhebeanlage",
  other_water_or_sanitary: "Sonstiges Wasser- oder Sanitärsystem",
  indoor_unit: "Inneneinheit",
  outdoor_unit: "Außeneinheit",
  burner: "Brenner",
  pump: "Pumpe",
  controller_or_gateway: "Regelung oder Gateway",
  collector: "Kollektor",
  other_component: "Sonstige Komponente",
};

export const EQUIPMENT_SUBTYPES_BY_CATEGORY: Record<
  EquipmentCategory,
  readonly EquipmentSubtype[]
> = {
  heat_generation: [
    "heat_pump",
    "gas_boiler",
    "oil_boiler",
    "biomass_boiler",
    "district_heat_interface",
    "combined_heat_power",
    "electric_heat_generator",
    "other_heat_generator",
  ],
  storage_and_hot_water: [
    "domestic_hot_water_storage",
    "buffer_storage",
    "combined_storage",
    "fresh_water_station",
    "instantaneous_water_heater",
    "domestic_hot_water_heat_pump",
    "other_storage_or_hot_water",
  ],
  ventilation: [
    "central_ventilation_with_heat_recovery",
    "decentral_ventilation_with_heat_recovery",
    "exhaust_air_ventilation",
    "other_ventilation",
  ],
  solar_thermal: [],
  water_and_sanitary_system: [
    "water_treatment",
    "pressure_boosting",
    "wastewater_lifting",
    "other_water_or_sanitary",
  ],
  system_component: [
    "indoor_unit",
    "outdoor_unit",
    "burner",
    "pump",
    "controller_or_gateway",
    "collector",
    "other_component",
  ],
  other: [],
};

export type EquipmentRow =
  Database["public"]["Tables"]["installed_equipment"]["Row"];
export type EquipmentIdentifierRow =
  Database["public"]["Tables"]["installed_equipment_identifiers"]["Row"];
export type EquipmentEventRow =
  Database["public"]["Tables"]["installed_equipment_events"]["Row"];
export type EquipmentEventLinkRow =
  Database["public"]["Tables"]["installed_equipment_event_links"]["Row"];
export type EquipmentWorkLinkRow =
  Database["public"]["Tables"]["installed_equipment_work_links"]["Row"];

export type EquipmentIdentifierInput = {
  identifierType: EquipmentIdentifierType;
  value: string;
  issuer?: string | null;
};

export type EquipmentFormInput = {
  clientId: string;
  siteId: string;
  parentEquipmentId?: string | null;
  name: string;
  category: EquipmentCategory;
  subtype?: EquipmentSubtype | null;
  state: EquipmentState;
  manufacturer?: string | null;
  model?: string | null;
  locationDetail?: string | null;
  technicalNotes?: string | null;
  installationDate?: string | null;
  commissioningDate?: string | null;
  warrantyProvider?: string | null;
  warrantyBasis?: string | null;
  warrantyStartDate?: string | null;
  warrantyEndDate?: string | null;
  identifiers: EquipmentIdentifierInput[];
  reason?: string | null;
  effectiveAt?: string | null;
};

export type EquipmentCreateInput = EquipmentFormInput & {
  equipmentId: string;
  idempotencyKey: string;
};

export type EquipmentUpdateInput = EquipmentFormInput & {
  equipmentId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
};

export type EquipmentTransitionInput = {
  equipmentId: string;
  expectedVersion: number;
  toState: EquipmentState;
  effectiveAt: string;
  reason: string;
  idempotencyKey: string;
};

export type EquipmentArchiveInput = {
  equipmentId: string;
  expectedVersion: number;
  archived: boolean;
  reason: string;
  idempotencyKey: string;
};

export type EquipmentReplacementInput = EquipmentFormInput & {
  predecessorId: string;
  successorId: string;
  expectedVersion: number;
  effectiveAt: string;
  reason: string;
  idempotencyKey: string;
};

export type EquipmentCorrectionInput = {
  equipmentId: string;
  expectedVersion: number;
  correctsEventId: string;
  effectiveAt: string;
  reason: string;
  idempotencyKey: string;
};

export type EquipmentWorkLinkInput = {
  equipmentId: string;
  expectedVersion: number;
  jobId?: string | null;
  projectId?: string | null;
  linked: boolean;
  reason?: string | null;
  idempotencyKey: string;
};

export type EquipmentSourceTargetType =
  "job" | "project" | "artifact_revision" | "handover_release" | "document";

export type EquipmentSourceInput = {
  equipmentId: string;
  expectedVersion: number;
  targetType: EquipmentSourceTargetType;
  targetId: string;
  documentVersionNumber?: number | null;
  reason: string;
  idempotencyKey: string;
};

export type EquipmentSourceOption = {
  value: string;
  targetType: EquipmentSourceTargetType;
  targetId: string;
  label: string;
  description: string;
  documentVersionNumber?: number;
};

export type EquipmentIdentifier = {
  id: string;
  identifierType: EquipmentIdentifierType;
  value: string;
  issuer: string | null;
};

export type EquipmentListItem = {
  id: string;
  equipmentNumber: string;
  name: string;
  category: EquipmentCategory;
  subtype: EquipmentSubtype | null;
  state: EquipmentState;
  manufacturer: string | null;
  model: string | null;
  locationDetail: string | null;
  clientId: string;
  clientName: string;
  siteId: string;
  siteName: string;
  siteAddress: string;
  parentEquipmentId: string | null;
  archivedAt: string | null;
  voidedAt: string | null;
  identifiers: EquipmentIdentifier[];
  version: number;
};

export type EquipmentEventLink = {
  id: string;
  jobId: string | null;
  projectId: string | null;
  workArtifactRevisionId: string | null;
  workHandoverReleaseId: string | null;
  documentId: string | null;
  documentVersionNumber: number | null;
  label: string;
  href: string | null;
};

export type EquipmentEvent = {
  id: string;
  eventType: Database["public"]["Enums"]["installed_equipment_event_type"];
  fromState: EquipmentState | null;
  toState: EquipmentState | null;
  effectiveAt: string;
  recordedAt: string;
  actorName: string;
  reason: string | null;
  correctsEventId: string | null;
  siteSnapshot: Json;
  beforeSnapshot: Json | null;
  afterSnapshot: Json;
  links: EquipmentEventLink[];
};

export type EquipmentWorkLink = {
  id: string;
  jobId: string | null;
  projectId: string | null;
  label: string;
  href: string;
};

export type EquipmentDetail = EquipmentListItem & {
  technicalNotes: string | null;
  installationDate: string | null;
  commissioningDate: string | null;
  warrantyProvider: string | null;
  warrantyBasis: string | null;
  warrantyStartDate: string | null;
  warrantyEndDate: string | null;
  predecessor: EquipmentListItem | null;
  successor: EquipmentListItem | null;
  parent: EquipmentListItem | null;
  components: EquipmentListItem[];
  events: EquipmentEvent[];
  workLinks: EquipmentWorkLink[];
};

export type EquipmentClientOption = {
  id: string;
  name: string;
  sites: Array<{
    id: string;
    name: string;
    address: string;
    isActive: boolean;
  }>;
};

export type EquipmentMutationResult =
  | { success: true; equipment: EquipmentRow }
  | { success: false; error: string };

export type EquipmentListResult =
  | {
      success: true;
      equipment: EquipmentListItem[];
      clients: EquipmentClientOption[];
    }
  | { success: false; error: string };

export type EquipmentDetailResult =
  | { success: true; equipment: EquipmentDetail }
  | { success: false; error: string };

export type EquipmentFieldProjection = Pick<
  EquipmentListItem,
  | "id"
  | "equipmentNumber"
  | "name"
  | "category"
  | "subtype"
  | "state"
  | "manufacturer"
  | "model"
  | "locationDetail"
>;
