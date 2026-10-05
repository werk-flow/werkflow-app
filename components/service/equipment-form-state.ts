import { describeFailure } from '@/lib/action-messages';
import {
  getEquipmentMutationErrorMessage,
  type EquipmentDetail,
  type EquipmentFormInput,
  type EquipmentIdentifierInput,
} from '@/lib/installed-equipment/types';
import type { ServiceCaseClientOption } from '@/lib/service-cases/types';

export type EquipmentFormMode = 'create' | 'edit' | 'replace';

export type EquipmentFormState = EquipmentFormInput & {
  serialNumber: string;
  productNumber: string;
  operatorNumber: string;
};

const EMPTY_FORM: EquipmentFormState = {
  clientId: '',
  siteId: '',
  parentEquipmentId: null,
  name: '',
  category: 'heat_generation',
  subtype: null,
  state: 'unknown',
  manufacturer: '',
  model: '',
  locationDetail: '',
  technicalNotes: '',
  installationDate: '',
  commissioningDate: '',
  warrantyProvider: '',
  warrantyBasis: '',
  warrantyStartDate: '',
  warrantyEndDate: '',
  identifiers: [],
  reason: '',
  effectiveAt: null,
  serialNumber: '',
  productNumber: '',
  operatorNumber: '',
};

export const GENERIC_EQUIPMENT_FORM_ERROR = 'Die Anlage konnte nicht gespeichert werden.';

const ERROR_MESSAGES: Record<string, string> = {
  installed_equipment_input_invalid: 'Bitte prüfe die markierten Angaben.',
  installed_equipment_duplicate_identifier: 'Diese Kennung wird bereits verwendet.',
  installed_equipment_action_failed: GENERIC_EQUIPMENT_FORM_ERROR,
};

export function errorMessage(code: string): string {
  return describeFailure(
    code,
    ERROR_MESSAGES,
    getEquipmentMutationErrorMessage(code, GENERIC_EQUIPMENT_FORM_ERROR),
  );
}

export type EquipmentRequiredField = 'clientId' | 'siteId' | 'name' | 'parentEquipmentId' | 'reason';

// Focus order on a failed submit; the ids double as the spec selectors.
export const EQUIPMENT_REQUIRED_FIELD_IDS: Array<[EquipmentRequiredField, string]> = [
  ['clientId', 'equipment-client'],
  ['siteId', 'equipment-site'],
  ['name', 'equipment-name'],
  ['parentEquipmentId', 'equipment-parent'],
  ['reason', 'equipment-reason'],
];

// Mirrors equipmentFormSchema and the update/replace reason rule so the user
// sees the missing field instead of "Bitte prüfe die markierten Angaben".
export function missingFields(
  form: EquipmentFormState,
  mode: EquipmentFormMode,
): Partial<Record<EquipmentRequiredField, string>> {
  const errors: Partial<Record<EquipmentRequiredField, string>> = {};
  if (!form.clientId) errors.clientId = 'Bitte wähle einen Kunden.';
  if (!form.siteId) errors.siteId = 'Bitte wähle einen Einsatzort.';
  if (form.name.trim().length < 2) {
    errors.name = 'Bitte gib eine Bezeichnung mit mindestens 2 Zeichen ein.';
  }
  if (form.category === 'system_component' && !form.parentEquipmentId) {
    errors.parentEquipmentId = 'Bitte wähle die übergeordnete Anlage.';
  }
  if (mode !== 'create' && (form.reason ?? '').trim().length < 3) {
    errors.reason = 'Bitte gib einen Grund mit mindestens 3 Zeichen an.';
  }
  return errors;
}

function fromEquipment(initial: EquipmentDetail): EquipmentFormState {
  const identifierValue = (type: string) =>
    initial.identifiers.find((identifier) => identifier.identifierType === type)?.value ?? '';
  return {
    ...EMPTY_FORM,
    clientId: initial.clientId,
    siteId: initial.siteId,
    parentEquipmentId: initial.parentEquipmentId,
    name: initial.name,
    category: initial.category,
    subtype: initial.subtype,
    state: initial.state,
    manufacturer: initial.manufacturer ?? '',
    model: initial.model ?? '',
    locationDetail: initial.locationDetail ?? '',
    technicalNotes: initial.technicalNotes ?? '',
    installationDate: initial.installationDate ?? '',
    commissioningDate: initial.commissioningDate ?? '',
    warrantyProvider: initial.warrantyProvider ?? '',
    warrantyBasis: initial.warrantyBasis ?? '',
    warrantyStartDate: initial.warrantyStartDate ?? '',
    warrantyEndDate: initial.warrantyEndDate ?? '',
    serialNumber: identifierValue('serial_number'),
    productNumber: identifierValue('manufacturer_product_number'),
    operatorNumber: identifierValue('operator_equipment_number'),
  };
}

/** A replacement starts empty at the predecessor's place; an edit starts from the record. */
export function initialEquipmentForm(
  mode: EquipmentFormMode,
  initial: EquipmentDetail | null | undefined,
): EquipmentFormState {
  if (!initial) return EMPTY_FORM;
  if (mode === 'replace') {
    return {
      ...EMPTY_FORM,
      clientId: initial.clientId,
      siteId: initial.siteId,
      parentEquipmentId: initial.parentEquipmentId,
      category: initial.category,
    };
  }
  return fromEquipment(initial);
}

export function toEquipmentFormPayload(form: EquipmentFormState): EquipmentFormInput {
  const identifiers: EquipmentIdentifierInput[] = [];
  if (form.serialNumber)
    identifiers.push({
      identifierType: 'serial_number',
      value: form.serialNumber,
      issuer: form.manufacturer || null,
    });
  if (form.productNumber)
    identifiers.push({
      identifierType: 'manufacturer_product_number',
      value: form.productNumber,
      issuer: form.manufacturer || null,
    });
  if (form.operatorNumber)
    identifiers.push({
      identifierType: 'operator_equipment_number',
      value: form.operatorNumber,
    });
  return { ...form, identifiers };
}

export type EquipmentSiteOption = { value: string; label: string; description: string };
export type EquipmentParentOption = { value: string; label: string };

/** Active sites of the chosen customer; a record under edit keeps its own site. */
export function equipmentSiteOptions(
  sites: ServiceCaseClientOption['sites'],
  form: EquipmentFormState,
  initial: EquipmentDetail | null | undefined,
): EquipmentSiteOption[] {
  const siteOptions = sites
    .filter((site) => site.isActive)
    .map((site) => ({ value: site.id, label: site.name, description: site.address }));
  if (
    initial &&
    form.siteId === initial.siteId &&
    !siteOptions.some((site) => site.value === initial.siteId)
  ) {
    siteOptions.push({
      value: initial.siteId,
      label: initial.siteName,
      description: initial.siteAddress,
    });
  }
  return siteOptions;
}

/** Top-level equipment of the chosen site; a record under edit keeps its stored parent. */
export function equipmentParentOptions(
  sites: ServiceCaseClientOption['sites'],
  form: EquipmentFormState,
  initial: EquipmentDetail | null | undefined,
): EquipmentParentOption[] {
  const parentOptions = (sites.find((site) => site.id === form.siteId)?.equipment ?? [])
    .filter((item) => !item.parentEquipmentId && item.id !== initial?.id)
    .map((item) => ({ value: item.id, label: `${item.equipmentNumber} · ${item.name}` }));
  const storedParent = initial?.parent;
  if (
    storedParent &&
    form.parentEquipmentId === storedParent.id &&
    !parentOptions.some((item) => item.value === storedParent.id)
  ) {
    parentOptions.push({
      value: storedParent.id,
      label: `${storedParent.equipmentNumber} · ${storedParent.name}`,
    });
  }
  return parentOptions;
}
