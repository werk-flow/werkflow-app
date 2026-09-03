"use client";

import { useMemo, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorText } from "@/components/ui/error-text";
import { Field } from "@/components/ui/field";
import { FormDisclosure } from "@/components/ui/form-disclosure";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";
import {
  createInstalledEquipment,
  replaceInstalledEquipment,
  updateInstalledEquipment,
} from "@/lib/installed-equipment/actions";
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATE_LABELS,
  EQUIPMENT_SUBTYPE_LABELS,
  EQUIPMENT_SUBTYPES_BY_CATEGORY,
  getEquipmentMutationErrorMessage,
  type EquipmentCategory,
  type EquipmentClientOption,
  type EquipmentDetail,
  type EquipmentFormInput,
  type EquipmentIdentifierInput,
  type EquipmentListItem,
  type EquipmentState,
  type EquipmentSubtype,
} from "@/lib/installed-equipment/types";

type EquipmentFormMode = "create" | "edit" | "replace";

/** The values a list can show for a record before the server confirms it. */
export type EquipmentPendingDraft = Pick<
  EquipmentListItem,
  | "id"
  | "name"
  | "category"
  | "state"
  | "clientName"
  | "siteName"
  | "manufacturer"
  | "model"
>;

export type EquipmentCreateSubmission = {
  draft: EquipmentPendingDraft;
  /** Never rejects; a failure carries the German message for the caller's banner. */
  result: Promise<{ success: true } | { success: false; message: string }>;
};

type EquipmentFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: EquipmentFormMode;
  clients: EquipmentClientOption[];
  equipment: EquipmentListItem[];
  initial?: EquipmentDetail | null;
  /**
   * Create from a list (feedback canon): the dialog closes at once and the
   * caller renders the pending row until `result` settles. Without it a
   * create navigates to the new record.
   */
  onSubmitted?: (submission: EquipmentCreateSubmission) => void;
  /** Edit settled by the caller (a live-view refresh) instead of a route refresh. */
  onSaved?: () => void;
};

type FormState = EquipmentFormInput & {
  serialNumber: string;
  productNumber: string;
  operatorNumber: string;
};

const EMPTY_FORM: FormState = {
  clientId: "",
  siteId: "",
  parentEquipmentId: null,
  name: "",
  category: "heat_generation",
  subtype: null,
  state: "unknown",
  manufacturer: "",
  model: "",
  locationDetail: "",
  technicalNotes: "",
  installationDate: "",
  commissioningDate: "",
  warrantyProvider: "",
  warrantyBasis: "",
  warrantyStartDate: "",
  warrantyEndDate: "",
  identifiers: [],
  reason: "",
  effectiveAt: null,
  serialNumber: "",
  productNumber: "",
  operatorNumber: "",
};

const GENERIC_ERROR = "Die Anlage konnte nicht gespeichert werden.";

const ERROR_MESSAGES: Record<string, string> = {
  installed_equipment_input_invalid: "Bitte prüfe die markierten Angaben.",
  installed_equipment_duplicate_identifier:
    "Diese Kennung wird bereits verwendet.",
  installed_equipment_action_failed: GENERIC_ERROR,
};

function errorMessage(code: string): string {
  return (
    ERROR_MESSAGES[code] ?? getEquipmentMutationErrorMessage(code, GENERIC_ERROR)
  );
}

type RequiredField = "clientId" | "siteId" | "name" | "parentEquipmentId" | "reason";

// Focus order on a failed submit; the ids double as the spec selectors.
const REQUIRED_FIELD_IDS: Array<[RequiredField, string]> = [
  ["clientId", "equipment-client"],
  ["siteId", "equipment-site"],
  ["name", "equipment-name"],
  ["parentEquipmentId", "equipment-parent"],
  ["reason", "equipment-reason"],
];

// Mirrors equipmentFormSchema and the update/replace reason rule so the user
// sees the missing field instead of "Bitte prüfe die markierten Angaben".
function missingFields(
  form: FormState,
  mode: EquipmentFormMode,
): Partial<Record<RequiredField, string>> {
  const errors: Partial<Record<RequiredField, string>> = {};
  if (!form.clientId) errors.clientId = "Bitte wähle einen Kunden.";
  if (!form.siteId) errors.siteId = "Bitte wähle einen Einsatzort.";
  if (form.name.trim().length < 2) {
    errors.name = "Bitte gib eine Bezeichnung mit mindestens 2 Zeichen ein.";
  }
  if (form.category === "system_component" && !form.parentEquipmentId) {
    errors.parentEquipmentId = "Bitte wähle die übergeordnete Anlage.";
  }
  if (mode !== "create" && (form.reason ?? "").trim().length < 3) {
    errors.reason = "Bitte gib einen Grund mit mindestens 3 Zeichen an.";
  }
  return errors;
}

function toDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateValue(value: Date | undefined): string {
  if (!value) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromEquipment(initial: EquipmentDetail): FormState {
  const identifierValue = (type: string) =>
    initial.identifiers.find((identifier) => identifier.identifierType === type)
      ?.value ?? "";
  return {
    ...EMPTY_FORM,
    clientId: initial.clientId,
    siteId: initial.siteId,
    parentEquipmentId: initial.parentEquipmentId,
    name: initial.name,
    category: initial.category,
    subtype: initial.subtype,
    state: initial.state,
    manufacturer: initial.manufacturer ?? "",
    model: initial.model ?? "",
    locationDetail: initial.locationDetail ?? "",
    technicalNotes: initial.technicalNotes ?? "",
    installationDate: initial.installationDate ?? "",
    commissioningDate: initial.commissioningDate ?? "",
    warrantyProvider: initial.warrantyProvider ?? "",
    warrantyBasis: initial.warrantyBasis ?? "",
    warrantyStartDate: initial.warrantyStartDate ?? "",
    warrantyEndDate: initial.warrantyEndDate ?? "",
    serialNumber: identifierValue("serial_number"),
    productNumber: identifierValue("manufacturer_product_number"),
    operatorNumber: identifierValue("operator_equipment_number"),
  };
}

export function EquipmentFormDialog({
  open,
  onOpenChange,
  mode,
  clients,
  equipment,
  initial,
  onSubmitted,
  onSaved,
}: EquipmentFormDialogProps): ReactElement {
  const router = useRouter();
  const { run: runCreate, isPending: isCreating } = useServerAction(
    createInstalledEquipment,
  );
  const { run: runUpdate, isPending: isUpdating } = useServerAction(
    updateInstalledEquipment,
  );
  const { run: runReplace, isPending: isReplacing } = useServerAction(
    replaceInstalledEquipment,
  );
  const [form, setForm] = useState<FormState>(() => {
    if (!initial) return EMPTY_FORM;
    if (mode === "replace") {
      return {
        ...EMPTY_FORM,
        clientId: initial.clientId,
        siteId: initial.siteId,
        parentEquipmentId: initial.parentEquipmentId,
        category: initial.category,
      };
    }
    return fromEquipment(initial);
  });
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const selectedClient = clients.find((client) => client.id === form.clientId);
  const siteOptions = (selectedClient?.sites ?? []).filter(
    (site) => site.isActive,
  );
  const parentOptions = equipment.filter(
    (item) =>
      item.siteId === form.siteId &&
      !item.parentEquipmentId &&
      !item.archivedAt,
  );
  const subtypeOptions = EQUIPMENT_SUBTYPES_BY_CATEGORY[form.category];
  const isPending = isCreating || isUpdating || isReplacing;
  const title =
    mode === "create"
      ? "Anlage erfassen"
      : mode === "edit"
        ? "Anlagendaten bearbeiten"
        : "Anlage ersetzen";
  const fieldErrors = attempted ? missingFields(form, mode) : {};

  const payload = useMemo<EquipmentFormInput>(() => {
    const identifiers: EquipmentIdentifierInput[] = [];
    if (form.serialNumber)
      identifiers.push({
        identifierType: "serial_number",
        value: form.serialNumber,
        issuer: form.manufacturer || null,
      });
    if (form.productNumber)
      identifiers.push({
        identifierType: "manufacturer_product_number",
        value: form.productNumber,
        issuer: form.manufacturer || null,
      });
    if (form.operatorNumber)
      identifiers.push({
        identifierType: "operator_equipment_number",
        value: form.operatorNumber,
      });
    return { ...form, identifiers };
  }, [form]);

  function updateField<Key extends keyof FormState>(
    key: Key,
    value: FormState[Key],
  ): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(): Promise<void> {
    setError(null);
    setAttempted(true);
    const errors = missingFields(form, mode);
    const firstInvalid = REQUIRED_FIELD_IDS.find(([key]) => errors[key]);
    if (firstInvalid) {
      document.getElementById(firstInvalid[1])?.focus();
      return;
    }
    const idempotencyKey = crypto.randomUUID();
    const effectiveAt = new Date().toISOString();
    if (mode === "create" && onSubmitted) {
      const equipmentId = crypto.randomUUID();
      onSubmitted({
        draft: {
          id: equipmentId,
          name: form.name.trim(),
          category: form.category,
          state: form.state,
          clientName: selectedClient?.name ?? "",
          siteName:
            siteOptions.find((site) => site.id === form.siteId)?.name ?? "",
          manufacturer: form.manufacturer || null,
          model: form.model || null,
        },
        result: runCreate({
          ...payload,
          equipmentId,
          idempotencyKey,
          effectiveAt,
        }).then(
          (created) =>
            created.success
              ? { success: true as const }
              : { success: false as const, message: errorMessage(created.error) },
          () => ({ success: false as const, message: GENERIC_ERROR }),
        ),
      });
      onOpenChange(false);
      return;
    }
    const result =
      mode === "create"
        ? await runCreate({
            ...payload,
            equipmentId: crypto.randomUUID(),
            idempotencyKey,
            effectiveAt,
          })
        : mode === "edit" && initial
          ? await runUpdate({
              ...payload,
              equipmentId: initial.id,
              expectedVersion: initial.version,
              reason: form.reason ?? "",
              idempotencyKey,
            })
          : initial
            ? await runReplace({
                ...payload,
                predecessorId: initial.id,
                successorId: crypto.randomUUID(),
                expectedVersion: initial.version,
                effectiveAt,
                reason: form.reason ?? "",
                idempotencyKey,
              })
            : {
                success: false as const,
                error: "installed_equipment_action_failed",
              };
    if (!result.success) {
      setError(errorMessage(result.error));
      return;
    }
    onOpenChange(false);
    if (mode === "edit" && onSaved) {
      onSaved();
      return;
    }
    router.push(
      `/service/anlagen/${encodeURIComponent(result.equipment.equipment_number)}`,
    );
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode === "replace"
              ? "Die bisherige Anlage und ihre Historie bleiben erhalten. Die neue Anlage erhält eine eigene Nummer."
              : "Ordne die Anlage einem vorhandenen Kunden und Einsatzort zu."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1 sm:grid-cols-2">
          <Field
            label="Kunde"
            htmlFor="equipment-client"
            required
            error={fieldErrors.clientId}
          >
            <SearchableSelect
              value={form.clientId}
              disabled={mode !== "create"}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  clientId: value,
                  siteId: "",
                  parentEquipmentId: null,
                }))
              }
              options={clients.map((client) => ({
                value: client.id,
                label: client.name,
              }))}
              placeholder="Kunde auswählen"
              searchPlaceholder="Kunde suchen..."
            />
          </Field>
          <Field
            label="Einsatzort"
            htmlFor="equipment-site"
            required
            error={fieldErrors.siteId}
          >
            <SearchableSelect
              value={form.siteId}
              disabled={!form.clientId || mode !== "create"}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  siteId: value,
                  parentEquipmentId: null,
                }))
              }
              options={siteOptions.map((site) => ({
                value: site.id,
                label: site.name,
                description: site.address,
              }))}
              placeholder="Einsatzort auswählen"
              searchPlaceholder="Einsatzort suchen..."
            />
          </Field>
          <Field
            label="Bezeichnung"
            htmlFor="equipment-name"
            required
            error={fieldErrors.name}
            className="sm:col-span-2"
          >
            <Input
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
              placeholder="z. B. Wärmepumpe Wohnhaus"
            />
          </Field>
          <Field label="Kategorie" htmlFor="equipment-category">
            <Select
              value={form.category}
              onValueChange={(value: EquipmentCategory) =>
                setForm((current) => ({
                  ...current,
                  category: value,
                  subtype: null,
                  parentEquipmentId:
                    value === "system_component"
                      ? current.parentEquipmentId
                      : null,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EQUIPMENT_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {EQUIPMENT_CATEGORY_LABELS[category]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Untertyp" htmlFor="equipment-subtype">
            <Select
              value={form.subtype ?? "none"}
              onValueChange={(value) =>
                updateField(
                  "subtype",
                  value === "none" ? null : (value as EquipmentSubtype),
                )
              }
              disabled={subtypeOptions.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="Nicht angegeben" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nicht angegeben</SelectItem>
                {subtypeOptions.map((subtype) => (
                  <SelectItem key={subtype} value={subtype}>
                    {EQUIPMENT_SUBTYPE_LABELS[subtype]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {form.category === "system_component" && (
            <Field
              label="Übergeordnete Anlage"
              htmlFor="equipment-parent"
              required
              error={fieldErrors.parentEquipmentId}
              className="sm:col-span-2"
            >
              <SearchableSelect
                value={form.parentEquipmentId ?? ""}
                disabled={mode === "replace"}
                onChange={(value) =>
                  updateField("parentEquipmentId", value || null)
                }
                options={parentOptions.map((item) => ({
                  value: item.id,
                  label: `${item.equipmentNumber} · ${item.name}`,
                }))}
                placeholder="Anlage auswählen"
                searchPlaceholder="Anlage suchen..."
              />
            </Field>
          )}
          {mode !== "edit" && (
            <Field label="Aktueller Zustand" htmlFor="equipment-state">
              <Select
                value={form.state}
                onValueChange={(value: EquipmentState) =>
                  updateField("state", value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["unknown", "active", "inactive"] as const).map((state) => (
                    <SelectItem key={state} value={state}>
                      {EQUIPMENT_STATE_LABELS[state]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Position am Einsatzort" htmlFor="equipment-location">
            <Input
              value={form.locationDetail ?? ""}
              onChange={(event) =>
                updateField("locationDetail", event.target.value)
              }
              placeholder="z. B. Heizraum, Keller"
            />
          </Field>
        </div>

        <FormDisclosure
          label="Technische Angaben und Kennungen"
          defaultOpen={mode === "edit"}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hersteller" htmlFor="equipment-manufacturer">
              <Input
                value={form.manufacturer ?? ""}
                onChange={(event) =>
                  updateField("manufacturer", event.target.value)
                }
              />
            </Field>
            <Field label="Modell" htmlFor="equipment-model">
              <Input
                value={form.model ?? ""}
                onChange={(event) => updateField("model", event.target.value)}
              />
            </Field>
            <Field label="Seriennummer" htmlFor="equipment-serial">
              <Input
                value={form.serialNumber}
                onChange={(event) =>
                  updateField("serialNumber", event.target.value)
                }
              />
            </Field>
            <Field
              label="Hersteller- oder Artikelnummer"
              htmlFor="equipment-product"
            >
              <Input
                value={form.productNumber}
                onChange={(event) =>
                  updateField("productNumber", event.target.value)
                }
              />
            </Field>
            <Field label="Betreiberkennung" htmlFor="equipment-operator">
              <Input
                value={form.operatorNumber}
                onChange={(event) =>
                  updateField("operatorNumber", event.target.value)
                }
              />
            </Field>
            <Field
              label="Technische Hinweise"
              htmlFor="equipment-notes"
              className="sm:col-span-2"
            >
              <Textarea
                value={form.technicalNotes ?? ""}
                onChange={(event) =>
                  updateField("technicalNotes", event.target.value)
                }
                placeholder="Nur dauerhafte technische Hinweise, keine Servicechronik"
              />
            </Field>
          </div>
        </FormDisclosure>

        <FormDisclosure label="Installation, Inbetriebnahme und Gewährleistung">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Installationsdatum"
              htmlFor="equipment-installation-date"
            >
              <DatePicker
                value={toDate(form.installationDate)}
                onChange={(value) =>
                  updateField("installationDate", toDateValue(value))
                }
              />
            </Field>
            <Field
              label="Inbetriebnahme"
              htmlFor="equipment-commissioning-date"
            >
              <DatePicker
                value={toDate(form.commissioningDate)}
                onChange={(value) =>
                  updateField("commissioningDate", toDateValue(value))
                }
              />
            </Field>
            <Field
              label="Gewährleistungsgeber"
              htmlFor="equipment-warranty-provider"
            >
              <Input
                value={form.warrantyProvider ?? ""}
                onChange={(event) =>
                  updateField("warrantyProvider", event.target.value)
                }
              />
            </Field>
            <Field label="Grundlage" htmlFor="equipment-warranty-basis">
              <Input
                value={form.warrantyBasis ?? ""}
                onChange={(event) =>
                  updateField("warrantyBasis", event.target.value)
                }
                placeholder="z. B. Vertrag oder Herstellerzusage"
              />
            </Field>
            <Field label="Beginn" htmlFor="equipment-warranty-start">
              <DatePicker
                value={toDate(form.warrantyStartDate)}
                onChange={(value) =>
                  updateField("warrantyStartDate", toDateValue(value))
                }
              />
            </Field>
            <Field label="Ende" htmlFor="equipment-warranty-end">
              <DatePicker
                value={toDate(form.warrantyEndDate)}
                onChange={(value) =>
                  updateField("warrantyEndDate", toDateValue(value))
                }
              />
            </Field>
          </div>
        </FormDisclosure>

        {mode !== "create" && (
          <Field
            label="Grund der Änderung"
            htmlFor="equipment-reason"
            required
            error={fieldErrors.reason}
          >
            <Textarea
              value={form.reason ?? ""}
              onChange={(event) => updateField("reason", event.target.value)}
              placeholder="Warum wird diese Änderung vorgenommen?"
            />
          </Field>
        )}
        <ErrorText>{error}</ErrorText>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isPending}
          >
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {mode === "replace" ? "Nachfolger anlegen" : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
