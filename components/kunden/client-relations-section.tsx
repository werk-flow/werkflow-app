"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  KeyRound,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Star,
  Users,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ErrorText } from "@/components/ui/error-text";
import { SectionError } from "@/components/ui/section-error";
import { useBanner } from "@/components/ui/banner";
import { usePendingTask } from "@/hooks/use-server-action";

import {
  createClientContact,
  createClientSite,
  updateClientContact,
  updateClientSite,
  type SaveClientContactInput,
  type SaveClientSiteInput,
} from "@/lib/clients/actions";
import {
  CONTACT_ROLE_SUGGESTIONS,
  formatSiteAddress,
  type ClientContact,
  type ClientSite,
} from "@/lib/clients/types";
import {
  EQUIPMENT_STATE_LABELS,
  type EquipmentListItem,
} from "@/lib/installed-equipment/types";

const ERROR_MESSAGES: Record<string, string> = {
  name_required: "Bitte gib einen Namen ein.",
  not_authorized: "Du hast keine Berechtigung für diese Aktion.",
  client_not_found: "Der Kunde wurde nicht gefunden.",
  contact_not_found: "Der Ansprechpartner wurde nicht gefunden.",
  site_not_found: "Der Einsatzort wurde nicht gefunden.",
  no_changes: "Keine Änderungen zum Speichern.",
  primary_flag_failed:
    "Gespeichert, aber die bisherige Hauptmarkierung konnte nicht entfernt werden. Bitte prüfe die Markierungen.",
};

function errorMessage(error: string): string {
  return (
    ERROR_MESSAGES[error] ??
    "Speichern fehlgeschlagen. Bitte versuche es erneut."
  );
}

// tel: links work most reliably with digits and a leading + only.
function normalizePhoneHref(phone: string): string {
  return phone.replace(/(?!^\+)[^\d]/g, "");
}

type ContactDraft = SaveClientContactInput;
type SiteDraft = SaveClientSiteInput;

const EMPTY_CONTACT: ContactDraft = {
  name: "",
  role: "",
  email: "",
  phone: "",
  notes: "",
  isPrimary: false,
};

const EMPTY_SITE: SiteDraft = {
  name: "",
  street: "",
  postalCode: "",
  city: "",
  accessNotes: "",
  notes: "",
  primaryContactId: null,
  isPrimary: false,
};

interface ClientRelationsSectionProps {
  clientId: string;
  clientAddress: string | null;
  contacts: ClientContact[];
  sites: ClientSite[];
  isAdminOrManager: boolean;
  equipment: EquipmentListItem[];
  equipmentLoadFailed: boolean;
  onRequestContact?: (input: {
    contactId: string;
    contactName: string;
    channel: "phone" | "email";
    href: string;
  }) => void;
}

export function ClientRelationsSection({
  clientId,
  clientAddress,
  contacts,
  sites,
  isAdminOrManager,
  equipment,
  equipmentLoadFailed,
  onRequestContact,
}: ClientRelationsSectionProps) {
  const router = useRouter();
  const { run: runRelationTask, isPending } = usePendingTask();
  const [sectionError, setSectionError] = useState<string | null>(null);
  const { showBanner } = useBanner();

  const [contactDialog, setContactDialog] = useState<{
    contactId: string | null;
    draft: ContactDraft;
    error: string | null;
    nameError?: string | null;
  } | null>(null);
  const [siteDialog, setSiteDialog] = useState<{
    siteId: string | null;
    draft: SiteDraft;
    error: string | null;
    nameError?: string | null;
  } | null>(null);

  const activeContacts = contacts.filter((contact) => contact.isActive);
  const inactiveContacts = contacts.filter((contact) => !contact.isActive);
  const activeSites = sites.filter((site) => site.isActive);
  const inactiveSites = sites.filter((site) => !site.isActive);

  function saveContact() {
    if (!contactDialog) return;
    if (!contactDialog.draft.name.trim()) {
      setContactDialog({ ...contactDialog, nameError: "Bitte gib einen Namen ein." });
      document.getElementById("contact-name")?.focus();
      return;
    }
    void runRelationTask(async () => {
      const { contactId, draft } = contactDialog;
      const result = contactId
        ? await updateClientContact(contactId, draft)
        : await createClientContact(clientId, draft);

      if (!result.success) {
        setContactDialog((current) =>
          current ? { ...current, error: errorMessage(result.error) } : current,
        );
        return;
      }
      setContactDialog(null);
      showBanner({
        variant: "success",
        message: "Ansprechpartner gespeichert.",
      });
      router.refresh();
    });
  }

  function saveSite() {
    if (!siteDialog) return;
    if (!siteDialog.draft.name.trim()) {
      setSiteDialog({ ...siteDialog, nameError: "Bitte gib eine Bezeichnung ein." });
      document.getElementById("site-name")?.focus();
      return;
    }
    void runRelationTask(async () => {
      const { siteId, draft } = siteDialog;
      const result = siteId
        ? await updateClientSite(siteId, draft)
        : await createClientSite(clientId, draft);

      if (!result.success) {
        setSiteDialog((current) =>
          current ? { ...current, error: errorMessage(result.error) } : current,
        );
        return;
      }
      setSiteDialog(null);
      showBanner({ variant: "success", message: "Einsatzort gespeichert." });
      router.refresh();
    });
  }

  function toggleContactActive(contact: ClientContact) {
    setSectionError(null);
    void runRelationTask(async () => {
      const result = await updateClientContact(contact.id, {
        isActive: !contact.isActive,
      });
      if (!result.success) {
        setSectionError(errorMessage(result.error));
        return;
      }
      router.refresh();
    });
  }

  function toggleSiteActive(site: ClientSite) {
    setSectionError(null);
    void runRelationTask(async () => {
      const result = await updateClientSite(site.id, {
        isActive: !site.isActive,
      });
      if (!result.success) {
        setSectionError(errorMessage(result.error));
        return;
      }
      router.refresh();
    });
  }

  function adoptAddressAsSite() {
    if (!clientAddress) return;
    setSiteDialog({
      siteId: null,
      draft: {
        ...EMPTY_SITE,
        name: "Hauptstandort",
        street: clientAddress,
        isPrimary: activeSites.length === 0,
      },
      error: null,
    });
  }

  const contactNameById = new Map(
    contacts.map((contact) => [contact.id, contact.name]),
  );

  return (
    <div className="space-y-4">
      {/* Ansprechpartner */}
      <div
        id="ansprechpartner"
        className="scroll-mt-4 rounded-lg border bg-card p-4 sm:p-5"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Users className="size-4" />
            Ansprechpartner
          </h3>
          {isAdminOrManager && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() =>
                setContactDialog({
                  contactId: null,
                  draft: {
                    ...EMPTY_CONTACT,
                    isPrimary: activeContacts.length === 0,
                  },
                  error: null,
                })
              }
            >
              <Plus className="size-3.5" />
              Ansprechpartner hinzufügen
            </Button>
          )}
        </div>

        {activeContacts.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-sm text-muted-foreground">
            Noch keine Ansprechpartner hinterlegt.
          </p>
        ) : (
          <ul className="space-y-2">
            {activeContacts.map((contact) => (
              <li
                key={contact.id}
                className="rounded-md border bg-background p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-medium">{contact.name}</p>
                      {contact.isPrimary && (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          <Star className="size-3" />
                          Hauptkontakt
                        </Badge>
                      )}
                      {contact.role && (
                        <Badge variant="outline" className="text-xs">
                          {contact.role}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
                      {contact.phone && (
                        <a
                          href={`tel:${normalizePhoneHref(contact.phone)}`}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={(event) => {
                            if (!onRequestContact) return;
                            event.preventDefault();
                            onRequestContact({
                              contactId: contact.id,
                              contactName: contact.name,
                              channel: "phone",
                              href: `tel:${normalizePhoneHref(contact.phone ?? "")}`,
                            });
                          }}
                        >
                          <Phone className="size-3.5" />
                          {contact.phone}
                        </a>
                      )}
                      {contact.email && (
                        <a
                          href={`mailto:${contact.email}`}
                          className="hover:text-foreground"
                          onClick={(event) => {
                            if (!onRequestContact) return;
                            event.preventDefault();
                            onRequestContact({
                              contactId: contact.id,
                              contactName: contact.name,
                              channel: "email",
                              href: `mailto:${contact.email ?? ""}`,
                            });
                          }}
                        >
                          {contact.email}
                        </a>
                      )}
                    </div>
                    {contact.notes && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {contact.notes}
                      </p>
                    )}
                  </div>
                  {isAdminOrManager && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground"
                        title="Ansprechpartner bearbeiten"
                        onClick={() =>
                          setContactDialog({
                            contactId: contact.id,
                            draft: {
                              name: contact.name,
                              role: contact.role ?? "",
                              email: contact.email ?? "",
                              phone: contact.phone ?? "",
                              notes: contact.notes ?? "",
                              isPrimary: contact.isPrimary,
                            },
                            error: null,
                          })
                        }
                      >
                        <Pencil className="size-3.5" />
                        <span className="sr-only">
                          Ansprechpartner bearbeiten
                        </span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground"
                        title="Ansprechpartner archivieren"
                        disabled={isPending}
                        onClick={() => toggleContactActive(contact)}
                      >
                        <Archive className="size-3.5" />
                        <span className="sr-only">
                          Ansprechpartner archivieren
                        </span>
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {inactiveContacts.length > 0 && (
          <div className="mt-3 border-t pt-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
              Archiviert
            </p>
            <ul className="space-y-1.5">
              {inactiveContacts.map((contact) => (
                <li
                  key={contact.id}
                  className="flex items-center justify-between gap-3 rounded-md px-3 py-1.5 text-sm text-muted-foreground"
                >
                  <span className="truncate">
                    {contact.name}
                    {contact.role ? ` · ${contact.role}` : ""}
                  </span>
                  {isAdminOrManager && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground"
                      title="Ansprechpartner wiederherstellen"
                      disabled={isPending}
                      onClick={() => toggleContactActive(contact)}
                    >
                      <ArchiveRestore className="size-3.5" />
                      <span className="sr-only">
                        Ansprechpartner wiederherstellen
                      </span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Einsatzorte */}
      <div
        id="einsatzorte"
        className="scroll-mt-4 rounded-lg border bg-card p-4 sm:p-5"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <MapPin className="size-4" />
            Einsatzorte
          </h3>
          {isAdminOrManager && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() =>
                setSiteDialog({
                  siteId: null,
                  draft: { ...EMPTY_SITE, isPrimary: activeSites.length === 0 },
                  error: null,
                })
              }
            >
              <Plus className="size-3.5" />
              Einsatzort hinzufügen
            </Button>
          )}
        </div>

        {equipmentLoadFailed && (
          <SectionError className="mb-3">
            Anlagen und Geräte konnten nicht geladen werden.
          </SectionError>
        )}

        {activeSites.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center">
            <p className="text-sm text-muted-foreground">
              Noch keine Einsatzorte hinterlegt.
            </p>
            {isAdminOrManager && clientAddress && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-8 text-xs"
                onClick={adoptAddressAsSite}
              >
                Adresse als Einsatzort übernehmen
              </Button>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {activeSites.map((site) => {
              const address = formatSiteAddress(site);
              const primaryContactName = site.primaryContactId
                ? contactNameById.get(site.primaryContactId)
                : null;
              return (
                <li
                  key={site.id}
                  className="rounded-md border bg-background p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="font-medium">{site.name}</p>
                        {site.isPrimary && (
                          <Badge variant="secondary" className="gap-1 text-xs">
                            <Star className="size-3" />
                            Hauptstandort
                          </Badge>
                        )}
                      </div>
                      {address && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {address}
                        </p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                        {primaryContactName && (
                          <span className="inline-flex items-center gap-1">
                            <Users className="size-3" />
                            {primaryContactName}
                          </span>
                        )}
                        {site.accessNotes && (
                          <span className="inline-flex items-center gap-1">
                            <KeyRound className="size-3" />
                            {site.accessNotes}
                          </span>
                        )}
                      </div>
                      {site.notes && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {site.notes}
                        </p>
                      )}
                      {!equipmentLoadFailed &&
                        equipment.some(
                          (item) => item.siteId === site.id && !item.archivedAt,
                        ) && (
                          <div className="mt-3 border-t pt-3">
                            <p className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              <Wrench className="size-3" />
                              Anlagen & Geräte
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {equipment
                                .filter(
                                  (item) =>
                                    item.siteId === site.id && !item.archivedAt,
                                )
                                .map((item) => (
                                  <Link
                                    key={item.id}
                                    href={`/service/anlagen/${encodeURIComponent(item.equipmentNumber)}`}
                                    className="rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-muted/50"
                                  >
                                    <span className="font-medium">
                                      {item.name}
                                    </span>
                                    <span className="ml-1 text-muted-foreground">
                                      · {EQUIPMENT_STATE_LABELS[item.state]}
                                    </span>
                                  </Link>
                                ))}
                            </div>
                          </div>
                        )}
                    </div>
                    {isAdminOrManager && (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground"
                          title="Einsatzort bearbeiten"
                          onClick={() =>
                            setSiteDialog({
                              siteId: site.id,
                              draft: {
                                name: site.name,
                                street: site.street ?? "",
                                postalCode: site.postalCode ?? "",
                                city: site.city ?? "",
                                accessNotes: site.accessNotes ?? "",
                                notes: site.notes ?? "",
                                primaryContactId: site.primaryContactId,
                                isPrimary: site.isPrimary,
                              },
                              error: null,
                            })
                          }
                        >
                          <Pencil className="size-3.5" />
                          <span className="sr-only">Einsatzort bearbeiten</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground"
                          title="Einsatzort archivieren"
                          disabled={isPending}
                          onClick={() => toggleSiteActive(site)}
                        >
                          <Archive className="size-3.5" />
                          <span className="sr-only">
                            Einsatzort archivieren
                          </span>
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {inactiveSites.length > 0 && (
          <div className="mt-3 border-t pt-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
              Archiviert
            </p>
            <ul className="space-y-1.5">
              {inactiveSites.map((site) => (
                <li
                  key={site.id}
                  className="flex items-center justify-between gap-3 rounded-md px-3 py-1.5 text-sm text-muted-foreground"
                >
                  <span className="truncate">
                    {site.name}
                    {formatSiteAddress(site)
                      ? ` · ${formatSiteAddress(site)}`
                      : ""}
                  </span>
                  {isAdminOrManager && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground"
                      title="Einsatzort wiederherstellen"
                      disabled={isPending}
                      onClick={() => toggleSiteActive(site)}
                    >
                      <ArchiveRestore className="size-3.5" />
                      <span className="sr-only">
                        Einsatzort wiederherstellen
                      </span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <ErrorText>{sectionError}</ErrorText>

      {/* Contact dialog */}
      <Dialog
        open={contactDialog !== null}
        onOpenChange={(open) => !open && setContactDialog(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {contactDialog?.contactId
                ? "Ansprechpartner bearbeiten"
                : "Ansprechpartner hinzufügen"}
            </DialogTitle>
            <DialogDescription>
              Ansprechpartner gehören zu diesem Kunden und können Aufträgen
              zugeordnet werden.
            </DialogDescription>
          </DialogHeader>
          {contactDialog && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                saveContact();
              }}
              noValidate
              className="grid gap-4"
            >
              <Field
                label="Name"
                htmlFor="contact-name"
                required
                error={contactDialog.nameError}
              >
                <Input
                  value={contactDialog.draft.name}
                  onChange={(e) =>
                    setContactDialog({
                      ...contactDialog,
                      draft: { ...contactDialog.draft, name: e.target.value },
                      error: null,
                      nameError: null,
                    })
                  }
                  placeholder="z. B. Sabine Krause"
                />
              </Field>
              <Field label="Rolle" htmlFor="contact-role">
                <Input
                  value={contactDialog.draft.role ?? ""}
                  onChange={(e) =>
                    setContactDialog({
                      ...contactDialog,
                      draft: { ...contactDialog.draft, role: e.target.value },
                    })
                  }
                  list="contact-role-suggestions"
                  placeholder="z. B. Hausverwaltung"
                />
                <datalist id="contact-role-suggestions">
                  {CONTACT_ROLE_SUGGESTIONS.map((role) => (
                    <option key={role} value={role} />
                  ))}
                </datalist>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Telefon" htmlFor="contact-phone">
                  <Input
                    value={contactDialog.draft.phone ?? ""}
                    onChange={(e) =>
                      setContactDialog({
                        ...contactDialog,
                        draft: {
                          ...contactDialog.draft,
                          phone: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="E-Mail" htmlFor="contact-email">
                  <Input
                    type="text"
                    inputMode="email"
                    value={contactDialog.draft.email ?? ""}
                    onChange={(e) =>
                      setContactDialog({
                        ...contactDialog,
                        draft: {
                          ...contactDialog.draft,
                          email: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
              </div>
              <Field label="Notizen" htmlFor="contact-notes">
                <Textarea
                  value={contactDialog.draft.notes ?? ""}
                  onChange={(e) =>
                    setContactDialog({
                      ...contactDialog,
                      draft: { ...contactDialog.draft, notes: e.target.value },
                    })
                  }
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={contactDialog.draft.isPrimary ?? false}
                  onCheckedChange={(checked) =>
                    setContactDialog({
                      ...contactDialog,
                      draft: {
                        ...contactDialog.draft,
                        isPrimary: checked === true,
                      },
                    })
                  }
                />
                Als Hauptkontakt festlegen
              </label>
              <ErrorText>{contactDialog.error}</ErrorText>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setContactDialog(null)}
                  disabled={isPending}
                >
                  Abbrechen
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending && (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  )}
                  Speichern
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Site dialog */}
      <Dialog
        open={siteDialog !== null}
        onOpenChange={(open) => !open && setSiteDialog(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {siteDialog?.siteId
                ? "Einsatzort bearbeiten"
                : "Einsatzort hinzufügen"}
            </DialogTitle>
            <DialogDescription>
              Ein Einsatzort ist ein dauerhafter Arbeitsort dieses Kunden, z. B.
              ein Gebäude oder eine Wohnung.
            </DialogDescription>
          </DialogHeader>
          {siteDialog && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                saveSite();
              }}
              noValidate
              className="flex min-h-0 flex-1 flex-col"
            >
              <DialogBody className="grid gap-4 py-1">
                <Field
                  label="Bezeichnung"
                  htmlFor="site-name"
                  required
                  error={siteDialog.nameError}
                >
                  <Input
                    value={siteDialog.draft.name}
                    onChange={(e) =>
                      setSiteDialog({
                        ...siteDialog,
                        draft: { ...siteDialog.draft, name: e.target.value },
                        error: null,
                        nameError: null,
                      })
                    }
                    placeholder="z. B. Hauptgebäude, Wohnung 3. OG"
                  />
                </Field>
                <Field label="Straße und Hausnummer" htmlFor="site-street">
                  <Input
                    value={siteDialog.draft.street ?? ""}
                    onChange={(e) =>
                      setSiteDialog({
                        ...siteDialog,
                        draft: { ...siteDialog.draft, street: e.target.value },
                      })
                    }
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
                  <Field label="PLZ" htmlFor="site-postal-code">
                    <Input
                      inputMode="numeric"
                      value={siteDialog.draft.postalCode ?? ""}
                      onChange={(e) =>
                        setSiteDialog({
                          ...siteDialog,
                          draft: {
                            ...siteDialog.draft,
                            postalCode: e.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Ort" htmlFor="site-city">
                    <Input
                      value={siteDialog.draft.city ?? ""}
                      onChange={(e) =>
                        setSiteDialog({
                          ...siteDialog,
                          draft: { ...siteDialog.draft, city: e.target.value },
                        })
                      }
                    />
                  </Field>
                </div>
                <Field label="Zugang & Schlüssel" htmlFor="site-access-notes">
                  <Textarea
                    value={siteDialog.draft.accessNotes ?? ""}
                    onChange={(e) =>
                      setSiteDialog({
                        ...siteDialog,
                        draft: {
                          ...siteDialog.draft,
                          accessNotes: e.target.value,
                        },
                      })
                    }
                    placeholder="z. B. Schlüssel bei Hausmeister, Parken im Hof"
                  />
                </Field>
                <Field label="Ansprechpartner vor Ort" htmlFor="site-primary-contact">
                  <SearchableSelect
                    options={contacts
                      // Archived contacts stay visible only while they are the
                      // current selection, so editing never silently drops them.
                      .filter(
                        (contact) =>
                          contact.isActive ||
                          contact.id === siteDialog.draft.primaryContactId,
                      )
                      .map((contact) => ({
                        value: contact.id,
                        label: `${contact.name}${contact.role ? ` (${contact.role})` : ""}${!contact.isActive ? " · archiviert" : ""}`,
                      }))}
                    value={siteDialog.draft.primaryContactId ?? ""}
                    onChange={(value) =>
                      setSiteDialog({
                        ...siteDialog,
                        draft: {
                          ...siteDialog.draft,
                          primaryContactId: value || null,
                        },
                      })
                    }
                    placeholder="Nicht festgelegt"
                    searchPlaceholder="Ansprechpartner suchen..."
                    emptyMessage="Kein Ansprechpartner gefunden"
                    allowNone
                    noneLabel="Nicht festgelegt"
                  />
                </Field>
                <Field label="Notizen" htmlFor="site-notes">
                  <Textarea
                    value={siteDialog.draft.notes ?? ""}
                    onChange={(e) =>
                      setSiteDialog({
                        ...siteDialog,
                        draft: { ...siteDialog.draft, notes: e.target.value },
                      })
                    }
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={siteDialog.draft.isPrimary ?? false}
                    onCheckedChange={(checked) =>
                      setSiteDialog({
                        ...siteDialog,
                        draft: {
                          ...siteDialog.draft,
                          isPrimary: checked === true,
                        },
                      })
                    }
                  />
                  Als Hauptstandort festlegen
                </label>
                <ErrorText>{siteDialog.error}</ErrorText>
              </DialogBody>
              <DialogFooter className="pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSiteDialog(null)}
                  disabled={isPending}
                >
                  Abbrechen
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending && (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  )}
                  Speichern
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
