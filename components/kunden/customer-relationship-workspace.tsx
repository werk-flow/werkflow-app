'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarClock,
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
  Filter,
  History,
  Loader2,
  MessageSquareWarning,
  Pencil,
  Plus,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { DateTimeField } from '@/components/ui/date-time-field';
import { ErrorText } from '@/components/ui/error-text';
import { FormDisclosure } from '@/components/ui/form-disclosure';
import { useBanner } from '@/components/ui/banner';
import { usePendingTask } from '@/hooks/use-server-action';
import {
  createCustomerFollowUp,
  getCustomerRelationshipBundle,
  saveCustomerCommunicationPreference,
  saveCustomerCommunicationSettings,
  transitionCustomerFollowUp,
  updateCustomerFollowUp,
} from '@/lib/customer-relationships/actions';
import {
  compareTimelineItems,
  isFollowUpOverdue,
} from '@/lib/customer-relationships/resolution';
import {
  formatBerlinDateTimeInput,
  parseBerlinDateTimeInput,
  tomorrowMorningInBerlin,
} from '@/lib/customer-relationships/date-time';
import type {
  ClientFollowUp,
  CommunicationChannel,
  CommunicationPreferenceInput,
  CommunicationPreferenceState,
  CommunicationPurpose,
  CommunicationSettingsInput,
  CustomerRelationshipBundle,
  FollowUpInput,
  FollowUpSourceType,
  TimelineCategory,
  TimelineItem,
} from '@/lib/customer-relationships/types';
import type { ClientContact } from '@/lib/clients/types';

const CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  phone: 'Telefon',
  email: 'E-Mail',
  sms: 'SMS',
  letter: 'Brief',
  in_person: 'Persönlich',
};

const PURPOSE_LABELS: Record<CommunicationPurpose, string> = {
  appointment_service: 'Termin und Service',
  marketing: 'Marketing',
  commercial_required: 'Erforderliche kaufmännische Kommunikation',
};

const STATE_LABELS: Record<CommunicationPreferenceState, string> = {
  allowed: 'Erlaubt',
  disallowed: 'Nicht erlaubt',
  unknown: 'Unbekannt',
};

const TIMELINE_LABELS: Record<TimelineItem['kind'], string> = {
  customer_created: 'Kunde angelegt',
  contact_created: 'Ansprechpartner angelegt',
  site_created: 'Einsatzort angelegt',
  request_received: 'Anfrage eingegangen',
  request_event: 'Anfrage aktualisiert',
  request_closed: 'Anfrage abgeschlossen',
  request_converted: 'Anfrage in Arbeit überführt',
  job_created: 'Auftrag angelegt',
  project_created: 'Projekt angelegt',
  document_linked: 'Dokument verknüpft',
  follow_up_event: 'Nachfassaktion geändert',
  communication_preference_event: 'Kontaktvorgabe geändert',
};

type FollowUpDraft = {
  id: string | null;
  title: string;
  note: string;
  ownerUserId: string;
  dueAt: string;
  sourceType: FollowUpSourceType | null;
  sourceId: string | null;
  sourceLabel: string | null;
};

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
  }).format(new Date(value));
}

function toDateTimeInput(value: string): string {
  return formatBerlinDateTimeInput(value);
}

function initialDueAt(): string {
  return tomorrowMorningInBerlin();
}

function communicationTargetLabel(
  contactId: string | null,
  contacts: ClientContact[]
): string {
  if (!contactId) return 'Kunde (Standard)';
  return contacts.find((contact) => contact.id === contactId)?.name ??
    'Archivierter Ansprechpartner';
}

function sourceForTimelineItem(item: TimelineItem): {
  type: FollowUpSourceType;
  id: string;
  label: string;
} | null {
  if (item.kind === 'contact_created') {
    return { type: 'contact', id: item.sourceId, label: item.reference };
  }
  if (item.kind === 'site_created') {
    return { type: 'site', id: item.sourceId, label: item.reference };
  }
  if (
    item.kind === 'request_received' ||
    item.kind === 'request_closed' ||
    item.kind === 'request_converted'
  ) {
    return { type: 'request', id: item.sourceId, label: item.reference };
  }
  if (item.kind === 'job_created') {
    return { type: 'job', id: item.sourceId, label: item.reference };
  }
  if (item.kind === 'project_created') {
    return { type: 'project', id: item.sourceId, label: item.reference };
  }
  return null;
}

export function CustomerRelationshipWorkspace({
  clientId,
  currentUserId,
  contacts,
  initialBundle,
}: {
  clientId: string;
  currentUserId: string;
  contacts: ClientContact[];
  initialBundle: CustomerRelationshipBundle;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusedFollowUpId = searchParams.get('followUp');
  const [persistedTimelineItems, setPersistedTimelineItems] = useState<
    TimelineItem[]
  >([]);
  const [nextTimelineCursor, setNextTimelineCursor] = useState<
    string | null | undefined
  >(undefined);
  const [timelineFilter, setTimelineFilter] = useState<'all' | TimelineCategory>('all');
  const [followUpDraft, setFollowUpDraft] = useState<FollowUpDraft | null>(null);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferenceOpen, setPreferenceOpen] = useState(false);
  const { run: runRelationshipTask, isPending } = usePendingTask();
  const { showBanner } = useBanner();

  const bundle = useMemo(() => {
    if (nextTimelineCursor === undefined) return initialBundle;
    const mergedTimeline = new Map<string, TimelineItem>();
    for (const item of initialBundle.timeline.items) {
      mergedTimeline.set(item.stableKey, item);
    }
    for (const item of persistedTimelineItems) {
      if (!mergedTimeline.has(item.stableKey)) {
        mergedTimeline.set(item.stableKey, item);
      }
    }
    return {
      ...initialBundle,
      timeline: {
        items: [...mergedTimeline.values()].sort(compareTimelineItems),
        nextCursor: nextTimelineCursor,
      },
    };
  }, [initialBundle, nextTimelineCursor, persistedTimelineItems]);

  const openFollowUps = useMemo(
    () => bundle.followUps.filter((followUp) => followUp.status === 'open'),
    [bundle.followUps]
  );
  const historicFollowUps = useMemo(
    () => bundle.followUps.filter((followUp) => followUp.status !== 'open'),
    [bundle.followUps]
  );
  const olderTimelineCursor = bundle.timeline.nextCursor;
  const visibleTimeline = useMemo(
    () =>
      timelineFilter === 'all'
        ? bundle.timeline.items
        : bundle.timeline.items.filter((item) => item.category === timelineFilter),
    [bundle.timeline.items, timelineFilter]
  );

  function loadOlderTimeline(cursor: string) {
    void runRelationshipTask(async () => {
      const result = await getCustomerRelationshipBundle(clientId, cursor);
      if (!result.success) {
        showBanner({
          variant: 'error',
          message: 'Die Kundenhistorie konnte nicht aktualisiert werden.',
        });
        return;
      }
      setPersistedTimelineItems((current) => {
        const mergedTimeline = new Map(
          (current.length > 0 ? current : initialBundle.timeline.items).map(
            (item) => [item.stableKey, item]
          )
        );
        for (const item of result.data.timeline.items) {
          if (!mergedTimeline.has(item.stableKey)) {
            mergedTimeline.set(item.stableKey, item);
          }
        }
        return [...mergedTimeline.values()].sort(compareTimelineItems);
      });
      setNextTimelineCursor(result.data.timeline.nextCursor);
    });
  }

  function openNewFollowUp(source?: {
    type: FollowUpSourceType;
    id: string;
    label: string;
  }) {
    const defaultOwner =
      bundle.followUpOwners.find((owner) => owner.userId === currentUserId) ??
      bundle.followUpOwners[0];
    setFollowUpDraft({
      id: null,
      title: '',
      note: '',
      ownerUserId: defaultOwner?.userId ?? '',
      dueAt: initialDueAt(),
      sourceType: source?.type ?? null,
      sourceId: source?.id ?? null,
      sourceLabel: source?.label ?? null,
    });
  }

  function openExistingFollowUp(followUp: ClientFollowUp) {
    setFollowUpDraft({
      id: followUp.id,
      title: followUp.title,
      note: followUp.note ?? '',
      ownerUserId: followUp.ownerUserId,
      dueAt: toDateTimeInput(followUp.dueAt),
      sourceType: followUp.sourceType,
      sourceId: followUp.sourceId,
      sourceLabel: followUp.sourceLabel,
    });
  }

  function saveFollowUp() {
    if (!followUpDraft) return;
    setFollowUpError(null);
    const dueDate = parseBerlinDateTimeInput(followUpDraft.dueAt);
    if (!followUpDraft.title.trim() || !followUpDraft.ownerUserId || !dueDate) {
      setFollowUpError('Bitte fülle Titel, Zuständigkeit und Fälligkeit aus.');
      return;
    }
    const input: FollowUpInput = {
      title: followUpDraft.title,
      note: followUpDraft.note,
      ownerUserId: followUpDraft.ownerUserId,
      dueAt: dueDate.toISOString(),
      sourceType: followUpDraft.sourceType ?? undefined,
      sourceId: followUpDraft.sourceId ?? undefined,
    };
    void runRelationshipTask(async () => {
      const result = followUpDraft.id
        ? await updateCustomerFollowUp(clientId, followUpDraft.id, input)
        : await createCustomerFollowUp(clientId, input);
      if (!result.success) {
        setFollowUpError('Die Nachfassaktion konnte nicht gespeichert werden.');
        return;
      }
      setFollowUpDraft(null);
      showBanner({ variant: 'success', message: 'Nachfassaktion gespeichert.' });
      router.refresh();
    });
  }

  function transitionFollowUp(
    followUp: ClientFollowUp,
    status: 'completed' | 'cancelled'
  ) {
    void runRelationshipTask(async () => {
      const result = await transitionCustomerFollowUp(clientId, followUp.id, status);
      if (!result.success) {
        showBanner({
          variant: 'error',
          message: 'Die Nachfassaktion konnte nicht aktualisiert werden.',
        });
        return;
      }
      showBanner({
        variant: 'success',
        message:
          status === 'completed'
            ? 'Nachfassaktion erledigt.'
            : 'Nachfassaktion abgebrochen.',
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-8" data-testid="customer-relationship-workspace">
      <section id="nachfassaktionen" className="scroll-mt-4 space-y-3" aria-labelledby="follow-ups-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 id="follow-ups-heading" className="flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="size-4 text-muted-foreground" />
              Nachfassaktionen
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Sichtbare nächste Schritte mit Zuständigkeit und Fälligkeit.
            </p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => openNewFollowUp()}>
            <Plus className="size-3.5" />
            Nachfassaktion
          </Button>
        </div>

        {openFollowUps.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
            Keine offenen Nachfassaktionen.
          </p>
        ) : (
          <div className="divide-y rounded-lg border bg-card" data-testid="customer-follow-ups">
            {openFollowUps.map((followUp) => {
              const overdue = isFollowUpOverdue(followUp.dueAt, followUp.status);
              return (
                <article
                  key={followUp.id}
                  className={`space-y-2 px-4 py-3 ${focusedFollowUpId === followUp.id ? 'bg-muted/60' : ''}`}
                  data-follow-up-id={followUp.id}
                  data-overdue={overdue ? 'true' : 'false'}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{followUp.title}</p>
                        {overdue && (
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          >
                            Überfällig
                          </Badge>
                        )}
                        {!followUp.ownerIsActiveManager && (
                          <Badge variant="outline">Neu zuweisen</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {followUp.ownerName} · fällig {formatDateTime(followUp.dueAt)}
                      </p>
                      {followUp.note && <p className="mt-2 text-sm text-muted-foreground">{followUp.note}</p>}
                      {followUp.sourceLabel && (
                        followUp.sourceHref ? (
                          <Link href={followUp.sourceHref} className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            Quelle: {followUp.sourceLabel}
                            <ExternalLink className="size-3" />
                          </Link>
                        ) : (
                          <p className="mt-2 text-xs text-muted-foreground">Quelle: {followUp.sourceLabel}</p>
                        )
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => openExistingFollowUp(followUp)} aria-label={`Nachfassaktion ${followUp.title} bearbeiten`}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8" disabled={isPending} onClick={() => transitionFollowUp(followUp, 'completed')} aria-label={`Nachfassaktion ${followUp.title} erledigen`}>
                        <Check className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8" disabled={isPending} onClick={() => transitionFollowUp(followUp, 'cancelled')} aria-label={`Nachfassaktion ${followUp.title} abbrechen`}>
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {historicFollowUps.length > 0 && (
          <FormDisclosure
            className="rounded-md border px-3 py-2"
            label={`Abgeschlossene und abgebrochene Nachfassaktionen (${historicFollowUps.length})`}
          >
            <div className="divide-y">
              {historicFollowUps.map((followUp) => (
                <div key={followUp.id} className="py-2 text-sm">
                  <p className="font-medium">{followUp.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {followUp.status === 'completed' ? 'Erledigt' : 'Abgebrochen'} · {formatDateTime(followUp.completedAt ?? followUp.cancelledAt ?? followUp.updatedAt)}
                  </p>
                  {followUp.resolutionNote && <p className="mt-1 text-xs text-muted-foreground">{followUp.resolutionNote}</p>}
                </div>
              ))}
            </div>
          </FormDisclosure>
        )}
      </section>

      <CommunicationPreferencesSection
        clientId={clientId}
        contacts={contacts}
        bundle={bundle}
        settingsOpen={settingsOpen}
        preferenceOpen={preferenceOpen}
        isPending={isPending}
        onSettingsOpenChange={setSettingsOpen}
        onPreferenceOpenChange={setPreferenceOpen}
        onSaved={() => router.refresh()}
        runTask={runRelationshipTask}
      />

      <section className="space-y-3" aria-labelledby="timeline-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 id="timeline-heading" className="flex items-center gap-2 text-sm font-semibold">
              <History className="size-4 text-muted-foreground" />
              Kundenhistorie
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Verknüpfte Quelldatensätze und nachvollziehbare Änderungen – keine Kopien.
            </p>
          </div>
          <div
            role="group"
            className="flex items-center gap-1"
            aria-label="Kundenhistorie filtern"
          >
            <Filter className="mr-1 size-3.5 text-muted-foreground" />
            {([
              ['all', 'Alle'],
              ['work', 'Arbeit'],
              ['documents', 'Dokumente'],
              ['internal', 'Intern'],
            ] as const).map(([value, label]) => (
              <Button key={value} variant={timelineFilter === value ? 'secondary' : 'ghost'} size="sm" className="h-8" aria-pressed={timelineFilter === value} onClick={() => setTimelineFilter(value)}>
                {label}
              </Button>
            ))}
          </div>
        </div>

        {visibleTimeline.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
            Für diesen Filter sind noch keine Einträge vorhanden.
          </p>
        ) : (
          <ol className="divide-y rounded-lg border bg-card" data-testid="customer-timeline">
            {visibleTimeline.map((item) => {
              const followUpSource = sourceForTimelineItem(item);
              return (
                <li key={item.stableKey} className="flex gap-3 px-4 py-3" data-timeline-key={item.stableKey}>
                  <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{TIMELINE_LABELS[item.kind]}</p>
                      <time className="text-xs tabular-nums text-muted-foreground" dateTime={item.occurredAt}>{formatDateTime(item.occurredAt)}</time>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{item.reference}</p>
                    {item.detail && <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.actorName ?? 'Nicht erfasst'}
                      {item.currentStateOnly ? ' · aktueller Quelldatensatz' : ''}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {item.sourceHref && item.sourceAvailable ? (
                        <Link href={item.sourceHref} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          Quelle öffnen <ExternalLink className="size-3" />
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">Quelle nicht mehr verfügbar</span>
                      )}
                      {followUpSource && (
                        <button type="button" className="text-xs text-primary hover:underline" onClick={() => openNewFollowUp(followUpSource)}>
                          Hierzu nachfassen
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {olderTimelineCursor && (
          <div className="space-y-2">
            {timelineFilter !== 'all' && (
              <p className="text-xs text-muted-foreground">
                Der Filter gilt für die bisher geladenen Einträge. Lade ältere
                Einträge, um weiter zurückzusuchen.
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => loadOlderTimeline(olderTimelineCursor)}
            >
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              Ältere Einträge laden
            </Button>
          </div>
        )}
      </section>

      <Dialog
        open={followUpDraft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setFollowUpDraft(null);
            setFollowUpError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{followUpDraft?.id ? 'Nachfassaktion bearbeiten' : 'Nachfassaktion anlegen'}</DialogTitle>
            <DialogDescription>Lege einen klaren nächsten Schritt mit Zuständigkeit und genauer Fälligkeit fest.</DialogDescription>
          </DialogHeader>
          {followUpDraft && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                saveFollowUp();
              }}
              noValidate
              className="space-y-4"
            >
              {followUpDraft.sourceLabel && <p className="rounded-md bg-muted px-3 py-2 text-sm">Quelle: {followUpDraft.sourceLabel}</p>}
              <div className="space-y-2">
                <Label htmlFor="follow-up-title">Titel</Label>
                <Input id="follow-up-title" value={followUpDraft.title} onChange={(event) => setFollowUpDraft({ ...followUpDraft, title: event.target.value })} maxLength={160} autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="follow-up-owner">Zuständig</Label>
                <SearchableSelect
                  id="follow-up-owner"
                  options={bundle.followUpOwners.map((owner) => ({
                    value: owner.userId,
                    label: owner.name,
                  }))}
                  value={followUpDraft.ownerUserId}
                  onChange={(value) => setFollowUpDraft({ ...followUpDraft, ownerUserId: value })}
                  placeholder="Person wählen"
                  searchPlaceholder="Person suchen..."
                  emptyMessage="Keine Person gefunden"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="follow-up-due-date">Fällig am</Label>
                <DateTimeField
                  idPrefix="follow-up-due"
                  value={followUpDraft.dueAt}
                  onChange={(value) => setFollowUpDraft({ ...followUpDraft, dueAt: value })}
                  dateAriaLabel="Fälligkeitsdatum"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="follow-up-note">Notiz</Label>
                <Textarea id="follow-up-note" value={followUpDraft.note} onChange={(event) => setFollowUpDraft({ ...followUpDraft, note: event.target.value })} maxLength={2000} rows={4} />
              </div>
              <ErrorText>{followUpError}</ErrorText>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setFollowUpDraft(null); setFollowUpError(null); }}>Abbrechen</Button>
                <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="size-4 animate-spin" />}Speichern</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CommunicationPreferencesSection({
  clientId,
  contacts,
  bundle,
  settingsOpen,
  preferenceOpen,
  isPending,
  onSettingsOpenChange,
  onPreferenceOpenChange,
  onSaved,
  runTask,
}: {
  clientId: string;
  contacts: ClientContact[];
  bundle: CustomerRelationshipBundle;
  settingsOpen: boolean;
  preferenceOpen: boolean;
  isPending: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  onPreferenceOpenChange: (open: boolean) => void;
  onSaved: () => void;
  runTask: (task: () => Promise<void>) => Promise<void | null>;
}) {
  const settings = bundle.communicationSettings;
  const { showBanner } = useBanner();
  const [settingsDraft, setSettingsDraft] = useState<CommunicationSettingsInput>({});
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [preferenceDraft, setPreferenceDraft] = useState<CommunicationPreferenceInput>({
    channel: 'phone',
    purpose: 'appointment_service',
    state: 'unknown',
  });

  function handlePreferenceOpenChange(open: boolean) {
    if (!open) {
      setPreferenceDraft({
        channel: 'phone',
        purpose: 'appointment_service',
        state: 'unknown',
      });
    }
    setPreferenceError(null);
    onPreferenceOpenChange(open);
  }

  function openSettings() {
    setSettingsDraft({
      preferredContactId: settings?.preferredContactId ?? undefined,
      preferredChannel: settings?.preferredChannel ?? undefined,
      doNotContactInstruction: settings?.doNotContactInstruction ?? '',
      contactTimeNote: settings?.contactTimeNote ?? '',
      languageNote: settings?.languageNote ?? '',
      accessibilityNote: settings?.accessibilityNote ?? '',
      sourceNote: settings?.sourceNote ?? '',
    });
    onSettingsOpenChange(true);
  }

  function saveSettings() {
    setSettingsError(null);
    void runTask(async () => {
      const result = await saveCustomerCommunicationSettings(clientId, settingsDraft);
      if (!result.success) {
        setSettingsError('Die allgemeinen Kontaktvorgaben konnten nicht gespeichert werden.');
        return;
      }
      onSettingsOpenChange(false);
      showBanner({ variant: 'success', message: 'Kontaktvorgaben gespeichert.' });
      onSaved();
    });
  }

  function savePreference() {
    setPreferenceError(null);
    void runTask(async () => {
      const result = await saveCustomerCommunicationPreference(clientId, preferenceDraft);
      if (!result.success) {
        setPreferenceError('Die Kontaktpräferenz konnte nicht gespeichert werden.');
        return;
      }
      handlePreferenceOpenChange(false);
      showBanner({ variant: 'success', message: 'Kontaktpräferenz gespeichert.' });
      onSaved();
    });
  }

  const preferredContactName = settings?.preferredContactId
    ? contacts.find((contact) => contact.id === settings.preferredContactId)?.name ?? 'Archivierter Ansprechpartner'
    : null;

  return (
    <section id="kontaktvorgaben" className="scroll-mt-4 space-y-3" aria-labelledby="communication-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="communication-heading" className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquareWarning className="size-4 text-muted-foreground" />
            Kontaktvorgaben
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">Hinweise für zukünftige Kontakte. Es werden keine Nachrichten versendet.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={openSettings}>Allgemein bearbeiten</Button>
          <Button variant="outline" size="sm" onClick={() => handlePreferenceOpenChange(true)}><Plus className="size-3.5" /> Präferenz</Button>
        </div>
      </div>

      {!settings && bundle.communicationPreferences.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-3">
          <p className="text-sm font-medium">Noch nicht konfiguriert</p>
          <p className="mt-1 text-xs text-muted-foreground">Unbekannt bedeutet weder erlaubt noch verboten. Vor einem Kontakt sollte die Situation geprüft werden.</p>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          {settings?.doNotContactInstruction && (
            <div className="flex gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <div><p className="font-medium">Nicht kontaktieren ohne Prüfung</p><p className="text-muted-foreground">{settings.doNotContactInstruction}</p></div>
            </div>
          )}
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Bevorzugter Kontakt</dt><dd>{preferredContactName ?? 'Nicht festgelegt'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Bevorzugter Kanal</dt><dd>{settings?.preferredChannel ? CHANNEL_LABELS[settings.preferredChannel] : 'Nicht festgelegt'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Kontaktzeit</dt><dd>{settings?.contactTimeNote || 'Nicht festgelegt'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Sprache / Barrierefreiheit</dt><dd>{[settings?.languageNote, settings?.accessibilityNote].filter(Boolean).join(' · ') || 'Nicht festgelegt'}</dd></div>
          </dl>
          {bundle.communicationPreferences.length > 0 && (
            <div className="divide-y border-t">
              {bundle.communicationPreferences.map((preference) => (
                <div key={preference.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div><p>{communicationTargetLabel(preference.contactId, contacts)} · {CHANNEL_LABELS[preference.channel]}</p><p className="text-xs text-muted-foreground">{PURPOSE_LABELS[preference.purpose]}{preference.sourceNote ? ` · Quelle: ${preference.sourceNote}` : ''}</p></div>
                  <Badge variant={preference.state === 'disallowed' ? 'destructive' : 'outline'}>{STATE_LABELS[preference.state]}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />Diese Angaben sind betriebliche Kontaktvorgaben und keine Aussage zur rechtlichen Zulässigkeit.</p>

      <Dialog
        open={settingsOpen}
        onOpenChange={(open) => {
          if (!open) setSettingsError(null);
          onSettingsOpenChange(open);
        }}
      >
        <DialogContent>
          <DialogHeader><DialogTitle>Allgemeine Kontaktvorgaben</DialogTitle><DialogDescription>Halte praktische Hinweise und ihre Quelle fest. Leere Felder bleiben unkonfiguriert.</DialogDescription></DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveSettings();
            }}
            noValidate
            className="flex min-h-0 flex-1 flex-col"
          >
          <DialogBody className="space-y-4 py-1">
            <div className="space-y-2"><Label htmlFor="preferred-contact">Bevorzugter Ansprechpartner</Label>
              <SearchableSelect
                id="preferred-contact"
                options={contacts
                  // The selected archived contact stays visible so editing
                  // never shows a raw id or silently drops the selection.
                  .filter(
                    (contact) =>
                      contact.isActive ||
                      contact.id === settingsDraft.preferredContactId
                  )
                  .map((contact) => ({
                    value: contact.id,
                    label: `${contact.name}${contact.isActive ? '' : ' · archiviert'}`,
                  }))}
                value={settingsDraft.preferredContactId ?? ''}
                onChange={(value) =>
                  setSettingsDraft({ ...settingsDraft, preferredContactId: value || undefined })
                }
                placeholder="Nicht festgelegt"
                searchPlaceholder="Ansprechpartner suchen..."
                emptyMessage="Kein Ansprechpartner gefunden"
                allowNone
                noneLabel="Nicht festgelegt"
              />
            </div>
            <div className="space-y-2"><Label htmlFor="preferred-channel">Bevorzugter Kanal</Label><Select value={settingsDraft.preferredChannel ?? '__none__'} onValueChange={(value) => setSettingsDraft({ ...settingsDraft, preferredChannel: value === '__none__' ? undefined : value as CommunicationChannel })}><SelectTrigger id="preferred-channel"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">Nicht festgelegt</SelectItem>{Object.entries(CHANNEL_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="dnc-note">Nicht-kontaktieren-Hinweis</Label><Textarea id="dnc-note" value={settingsDraft.doNotContactInstruction ?? ''} onChange={(event) => setSettingsDraft({ ...settingsDraft, doNotContactInstruction: event.target.value })} rows={3} /></div>
            <div className="space-y-2"><Label htmlFor="contact-time">Geeignete Kontaktzeit</Label><Input id="contact-time" value={settingsDraft.contactTimeNote ?? ''} onChange={(event) => setSettingsDraft({ ...settingsDraft, contactTimeNote: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="language-note">Sprache</Label><Input id="language-note" value={settingsDraft.languageNote ?? ''} onChange={(event) => setSettingsDraft({ ...settingsDraft, languageNote: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="accessibility-note">Barrierefreiheit / Unterstützungsbedarf</Label><Textarea id="accessibility-note" value={settingsDraft.accessibilityNote ?? ''} onChange={(event) => setSettingsDraft({ ...settingsDraft, accessibilityNote: event.target.value })} rows={2} /></div>
            <div className="space-y-2"><Label htmlFor="settings-source">Quelle der Angaben</Label><Input id="settings-source" value={settingsDraft.sourceNote ?? ''} onChange={(event) => setSettingsDraft({ ...settingsDraft, sourceNote: event.target.value })} placeholder="z. B. Kundengespräch am 10.08.2026" /></div>
            <ErrorText>{settingsError}</ErrorText>
          </DialogBody>
          <DialogFooter className="pt-4"><Button type="button" variant="outline" onClick={() => { setSettingsError(null); onSettingsOpenChange(false); }}>Abbrechen</Button><Button type="submit" disabled={isPending}>{isPending && <Loader2 className="size-4 animate-spin" />}Speichern</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={preferenceOpen} onOpenChange={handlePreferenceOpenChange}>
        <DialogContent>
          <DialogHeader><DialogTitle>Kontaktpräferenz festhalten</DialogTitle><DialogDescription>Die Vorgabe gilt für den gewählten Zweck und Kanal. Ansprechpartner-spezifische Angaben überschreiben den Kundenstandard.</DialogDescription></DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              savePreference();
            }}
            noValidate
            className="space-y-4"
          >
            <div className="space-y-2"><Label htmlFor="preference-contact">Gilt für</Label>
              <SearchableSelect
                id="preference-contact"
                options={contacts
                  .filter(
                    (contact) =>
                      contact.isActive || contact.id === preferenceDraft.contactId
                  )
                  .map((contact) => ({
                    value: contact.id,
                    label: `${contact.name}${contact.isActive ? '' : ' · archiviert'}`,
                  }))}
                value={preferenceDraft.contactId ?? ''}
                onChange={(value) =>
                  setPreferenceDraft({ ...preferenceDraft, contactId: value || undefined })
                }
                placeholder="Kunde (Standard)"
                searchPlaceholder="Ansprechpartner suchen..."
                emptyMessage="Kein Ansprechpartner gefunden"
                allowNone
                noneLabel="Kunde (Standard)"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="preference-channel">Kanal</Label><Select value={preferenceDraft.channel} onValueChange={(value) => setPreferenceDraft({ ...preferenceDraft, channel: value as CommunicationChannel })}><SelectTrigger id="preference-channel"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CHANNEL_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label htmlFor="preference-state">Status</Label><Select value={preferenceDraft.state} onValueChange={(value) => setPreferenceDraft({ ...preferenceDraft, state: value as CommunicationPreferenceState })}><SelectTrigger id="preference-state"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(STATE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="space-y-2"><Label htmlFor="preference-purpose">Zweck</Label><Select value={preferenceDraft.purpose} onValueChange={(value) => setPreferenceDraft({ ...preferenceDraft, purpose: value as CommunicationPurpose })}><SelectTrigger id="preference-purpose"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(PURPOSE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="preference-source">Quelle der Angabe</Label><Input id="preference-source" value={preferenceDraft.sourceNote ?? ''} onChange={(event) => setPreferenceDraft({ ...preferenceDraft, sourceNote: event.target.value })} placeholder="z. B. ausdrückliche Angabe im Telefonat" /></div>
            <ErrorText>{preferenceError}</ErrorText>
            <DialogFooter><Button type="button" variant="outline" onClick={() => handlePreferenceOpenChange(false)}>Abbrechen</Button><Button type="submit" disabled={isPending}>{isPending && <Loader2 className="size-4 animate-spin" />}Speichern</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
