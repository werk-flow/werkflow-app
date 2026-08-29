"use client";

import Link from "next/link";
import { useMemo, useState, type ReactElement } from "react";
import { MapPin, Plus, Search, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLiveView } from "@/hooks/use-live-view";
import { getInstalledEquipmentList } from "@/lib/installed-equipment/actions";
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATE_LABELS,
  type EquipmentCategory,
  type EquipmentClientOption,
  type EquipmentListItem,
} from "@/lib/installed-equipment/types";
import { EquipmentFormDialog } from "./equipment-form-dialog";

type EquipmentListContentProps = {
  initialEquipment: EquipmentListItem[];
  clients: EquipmentClientOption[];
};

export function EquipmentListContent({
  initialEquipment,
  clients,
}: EquipmentListContentProps): ReactElement {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<EquipmentCategory | "all">("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const live = useLiveView({
    tables: ["installed_equipment"],
    initialData: initialEquipment,
    read: async () => {
      const result = await getInstalledEquipmentList();
      return result.success
        ? { ok: true as const, data: result.equipment }
        : { ok: false as const, error: result.error };
    },
  });
  const equipment = live.data ?? initialEquipment;
  const normalizedSearch = search.trim().toLocaleLowerCase("de-DE");
  const filtered = useMemo(
    () =>
      equipment.filter((item) => {
        if (!includeArchived && item.archivedAt) return false;
        if (category !== "all" && item.category !== category) return false;
        if (!normalizedSearch) return true;
        return [
          item.equipmentNumber,
          item.name,
          item.manufacturer,
          item.model,
          item.clientName,
          item.siteName,
          ...item.identifiers.map((identifier) => identifier.value),
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("de-DE")
          .includes(normalizedSearch);
      }),
    [category, equipment, includeArchived, normalizedSearch],
  );

  return (
    <>
      <div className="space-y-4">
        {live.isStale && (
          <p
            role="status"
            className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm"
          >
            Die angezeigten Anlagendaten konnten nicht aktualisiert werden.
          </p>
        )}
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
              aria-label="Anlagen durchsuchen"
              placeholder="Nummer, Name, Hersteller, Modell, Kunde oder Kennung suchen..."
            />
          </div>
          <Select
            value={category}
            onValueChange={(value) =>
              setCategory(value as EquipmentCategory | "all")
            }
          >
            <SelectTrigger
              className="w-full md:w-64"
              aria-label="Anlagen nach Kategorie filtern"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Kategorien</SelectItem>
              {EQUIPMENT_CATEGORIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {EQUIPMENT_CATEGORY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant={includeArchived ? "secondary" : "outline"}
            onClick={() => setIncludeArchived((value) => !value)}
          >
            Archivierte {includeArchived ? "ausblenden" : "anzeigen"}
          </Button>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed px-6 py-12 text-center">
            <Wrench className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-3 text-lg font-semibold">
              Keine passenden Anlagen
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Erfasse die erste installierte Anlage oder passe die Suche an.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border shadow-xs">
            <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-4 border-b bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid">
              <span>Anlage</span>
              <span>Kunde & Einsatzort</span>
              <span>Hersteller</span>
              <span>Zustand</span>
            </div>
            <div className="divide-y">
              {filtered.map((item) => (
                <Link
                  key={item.id}
                  href={`/service/anlagen/${encodeURIComponent(item.equipmentNumber)}`}
                  className="grid gap-2 px-4 py-3 transition-colors hover:bg-muted/40 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center md:gap-4"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {item.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {item.equipmentNumber} ·{" "}
                      {EQUIPMENT_CATEGORY_LABELS[item.category]}
                    </span>
                  </span>
                  <span className="min-w-0 text-sm">
                    <span className="block truncate">{item.clientName}</span>
                    <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <MapPin className="size-3 shrink-0" />
                      {item.siteName}
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {[item.manufacturer, item.model]
                      .filter(Boolean)
                      .join(" · ") || "Nicht erfasst"}
                  </span>
                  <span className="w-fit rounded-md bg-muted px-2 py-1 text-xs font-medium">
                    {item.archivedAt
                      ? "Archiviert"
                      : EQUIPMENT_STATE_LABELS[item.state]}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <Button
        type="button"
        className="fixed bottom-6 right-6 shadow-lg md:static md:hidden"
        onClick={() => setCreateOpen(true)}
        aria-label="Anlage erfassen"
      >
        <Plus className="size-4" />
        Anlage erfassen
      </Button>
      {createOpen && (
        <EquipmentFormDialog
          open
          onOpenChange={setCreateOpen}
          mode="create"
          clients={clients}
          equipment={equipment}
        />
      )}
    </>
  );
}

export function EquipmentCreateButton({
  clients,
  equipment,
}: {
  clients: EquipmentClientOption[];
  equipment: EquipmentListItem[];
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Anlage erfassen
      </Button>
      {open && (
        <EquipmentFormDialog
          open
          onOpenChange={setOpen}
          mode="create"
          clients={clients}
          equipment={equipment}
        />
      )}
    </>
  );
}
