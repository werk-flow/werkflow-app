"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactElement } from "react";
import { MapPin, Plus, Search, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListRow } from "@/components/ui/list-row";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { SkeletonColumn } from "@/components/ui/skeleton-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

// One column definition for the loaded table and its skeleton (design canon):
// header count, widths and hover cannot drift apart.
const TWO_LINE_CELL = (
  <span className="block space-y-1.5">
    <Skeleton className="h-4 w-40" />
    <Skeleton className="h-3 w-24" />
  </span>
);
export const EQUIPMENT_COLUMNS: readonly SkeletonColumn[] = [
  { id: "equipment", header: "Anlage", skeleton: TWO_LINE_CELL },
  { id: "site", header: "Kunde & Einsatzort", skeleton: TWO_LINE_CELL },
  {
    id: "manufacturer",
    header: "Hersteller",
    skeleton: <Skeleton className="h-4 w-32" />,
  },
  {
    id: "state",
    header: "Zustand",
    className: "w-40",
    skeleton: <Skeleton className="h-6 w-24" />,
  },
];

function equipmentHref(equipmentNumber: string): string {
  return `/service/anlagen/${encodeURIComponent(equipmentNumber)}`;
}

function stateLabel(item: EquipmentListItem): string {
  return item.archivedAt ? "Archiviert" : EQUIPMENT_STATE_LABELS[item.state];
}

type EquipmentListContentProps = {
  initialEquipment: EquipmentListItem[];
  clients: EquipmentClientOption[];
};

export function EquipmentListContent({
  initialEquipment,
  clients,
}: EquipmentListContentProps): ReactElement {
  const router = useRouter();
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
          <>
            <div className="space-y-2 md:hidden">
              {filtered.map((item) => (
                <ListRow key={item.id} asChild interactive>
                  <Link href={equipmentHref(item.equipmentNumber)}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {item.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.equipmentNumber} · {item.clientName} ·{" "}
                        {item.siteName}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium">
                      {stateLabel(item)}
                    </span>
                  </Link>
                </ListRow>
              ))}
            </div>
            <div className="hidden rounded-lg border shadow-xs md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    {EQUIPMENT_COLUMNS.map((column) => (
                      <TableHead key={column.id} className={column.className}>
                        {column.header}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((item) => {
                    const href = equipmentHref(item.equipmentNumber);
                    return (
                      <TableRow
                        key={item.id}
                        interactive
                        onClick={() => router.push(href)}
                      >
                        <TableCell>
                          <Link
                            href={href}
                            className="font-medium"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {item.name}
                          </Link>
                          <span className="block text-xs text-muted-foreground">
                            {item.equipmentNumber} ·{" "}
                            {EQUIPMENT_CATEGORY_LABELS[item.category]}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="block">{item.clientName}</span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="size-3 shrink-0" />
                            {item.siteName}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {[item.manufacturer, item.model]
                            .filter(Boolean)
                            .join(" · ") || "Nicht erfasst"}
                        </TableCell>
                        <TableCell>
                          <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                            {stateLabel(item)}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
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
