"use client";

import { useMemo, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

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
import { FormDisclosure } from "@/components/ui/form-disclosure";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type EquipmentFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: EquipmentFormMode;
  clients: EquipmentClientOption[];
  equipment: EquipmentListItem[];
  initial?: EquipmentDetail | null;
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

const ERROR_MESSAGES: Record<string, string> = {
  installed_equipment_input_invalid: "Bitte prüfe die markierten Angaben.",
  installed_equipment_duplicate_identifier:
    "Diese Kennung wird bereits verwendet.",
  installed_equipment_action_failed:
    "Die Anlage konnte nicht gespeichert werden.",
};

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
    const idempotencyKey = crypto.randomUUID();
    const effectiveAt = new Date().toISOString();
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
      setError(
        ERROR_MESSAGES[result.error] ??
          getEquipmentMutationErrorMessage(
            result.error,
            "Die Anlage konnte nicht gespeichert werden.",
          ),
      );
      return;
    }
    onOpenChange(false);
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
          <div className="space-y-2">
            <Label htmlFor="equipment-client">Kunde</Label>
            <SearchableSelect
              id="equipment-client"
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="equipment-site">Einsatzort</Label>
            <SearchableSelect
              id="equipment-site"
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
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="equipment-name">Bezeichnung</Label>
            <Input
              id="equipment-name"
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
              placeholder="z. B. Wärmepumpe Wohnhaus"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="equipment-category">Kategorie</Label>
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
              <SelectTrigger id="equipment-category">
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="equipment-subtype">Untertyp</Label>
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
              <SelectTrigger id="equipment-subtype">
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
          </div>
          {form.category === "system_component" && (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="equipment-parent">Übergeordnete Anlage</Label>
              <SearchableSelect
                id="equipment-parent"
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
            </div>
          )}
          {mode !== "edit" && (
            <div className="space-y-2">
              <Label htmlFor="equipment-state">Aktueller Zustand</Label>
              <Select
                value={form.state}
                onValueChange={(value: EquipmentState) =>
                  updateField("state", value)
                }
              >
                <SelectTrigger id="equipment-state">
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
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="equipment-location">Position am Einsatzort</Label>
            <Input
              id="equipment-location"
              value={form.locationDetail ?? ""}
              onChange={(event) =>
                updateField("locationDetail", event.target.value)
              }
              placeholder="z. B. Heizraum, Keller"
            />
          </div>
        </div>

        <FormDisclosure
          label="Technische Angaben und Kennungen"
          defaultOpen={mode === "edit"}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="equipment-manufacturer">Hersteller</Label>
              <Input
                id="equipment-manufacturer"
                value={form.manufacturer ?? ""}
                onChange={(event) =>
                  updateField("manufacturer", event.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipment-model">Modell</Label>
              <Input
                id="equipment-model"
                value={form.model ?? ""}
                onChange={(event) => updateField("model", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipment-serial">Seriennummer</Label>
              <Input
                id="equipment-serial"
                value={form.serialNumber}
                onChange={(event) =>
                  updateField("serialNumber", event.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipment-product">
                Hersteller- oder Artikelnummer
              </Label>
              <Input
                id="equipment-product"
                value={form.productNumber}
                onChange={(event) =>
                  updateField("productNumber", event.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipment-operator">Betreiberkennung</Label>
              <Input
                id="equipment-operator"
                value={form.operatorNumber}
                onChange={(event) =>
                  updateField("operatorNumber", event.target.value)
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="equipment-notes">Technische Hinweise</Label>
              <Textarea
                id="equipment-notes"
                value={form.technicalNotes ?? ""}
                onChange={(event) =>
                  updateField("technicalNotes", event.target.value)
                }
                placeholder="Nur dauerhafte technische Hinweise, keine Servicechronik"
              />
            </div>
          </div>
        </FormDisclosure>

        <FormDisclosure label="Installation, Inbetriebnahme und Gewährleistung">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="equipment-installation-date">
                Installationsdatum
              </Label>
              <DatePicker
                id="equipment-installation-date"
                value={toDate(form.installationDate)}
                onChange={(value) =>
                  updateField("installationDate", toDateValue(value))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipment-commissioning-date">
                Inbetriebnahme
              </Label>
              <DatePicker
                id="equipment-commissioning-date"
                value={toDate(form.commissioningDate)}
                onChange={(value) =>
                  updateField("commissioningDate", toDateValue(value))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipment-warranty-provider">
                Gewährleistungsgeber
              </Label>
              <Input
                id="equipment-warranty-provider"
                value={form.warrantyProvider ?? ""}
                onChange={(event) =>
                  updateField("warrantyProvider", event.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipment-warranty-basis">Grundlage</Label>
              <Input
                id="equipment-warranty-basis"
                value={form.warrantyBasis ?? ""}
                onChange={(event) =>
                  updateField("warrantyBasis", event.target.value)
                }
                placeholder="z. B. Vertrag oder Herstellerzusage"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipment-warranty-start">Beginn</Label>
              <DatePicker
                id="equipment-warranty-start"
                value={toDate(form.warrantyStartDate)}
                onChange={(value) =>
                  updateField("warrantyStartDate", toDateValue(value))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipment-warranty-end">Ende</Label>
              <DatePicker
                id="equipment-warranty-end"
                value={toDate(form.warrantyEndDate)}
                onChange={(value) =>
                  updateField("warrantyEndDate", toDateValue(value))
                }
              />
            </div>
          </div>
        </FormDisclosure>

        {mode !== "create" && (
          <div className="space-y-2">
            <Label htmlFor="equipment-reason">Grund der Änderung</Label>
            <Textarea
              id="equipment-reason"
              value={form.reason ?? ""}
              onChange={(event) => updateField("reason", event.target.value)}
              placeholder="Warum wird diese Änderung vorgenommen?"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

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
            {isPending
              ? "Wird gespeichert..."
              : mode === "replace"
                ? "Nachfolger anlegen"
                : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
