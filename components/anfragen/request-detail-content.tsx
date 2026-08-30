'use client';

import { useState } from 'react';
import { usePendingTask } from '@/hooks/use-server-action';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRightLeft,
  Building2,
  CircleCheck,
  History,
  Loader2,
  Pencil,
  Phone,
  RotateCcw,
  UserPlus,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useBanner } from '@/components/ui/banner';
import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { ClientSelectWithCreate } from '@/components/auftraege/client-select-with-create';
import { SiteContactFields } from '@/components/auftraege/site-contact-fields';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import {
  promoteCallerToClient,
  reopenClientRequest,
  updateClientRequest,
} from '@/lib/requests/actions';
import {
  REQUEST_CATEGORY_LABELS,
  REQUEST_CLOSE_REASON_LABELS,
  REQUEST_SOURCE_LABELS,
  type ClientRequest,
} from '@/lib/requests/types';
import type { Client } from '@/lib/jobs/types';
import type { OrganizationDocument } from '@/lib/documents/types';
import { RequestStatusBadge, RequestUrgencyBadge } from './request-badges';
import { CloseRequestDialog } from './close-request-dialog';
import { ConvertRequestDialog } from './convert-request-dialog';
import { EditRequestDialog } from './edit-request-dialog';
import { ConvertRequestToServiceDialog } from './convert-request-to-service-dialog';

export type RequestEventEntry = {
  id: string;
  eventType: string;
  createdAt: string;
  actorName: string | null;
};

export type RequestDetailData = {
  request: ClientRequest;
  clientName: string | null;
  siteLabel: string | null;
  contactLabel: string | null;
  contactPhone: string | null;
  assigneeName: string | null;
  convertedLink: { label: string; href: string | null } | null;
  documents: OrganizationDocument[];
  events: RequestEventEntry[];
  clients: Client[];
  assignees: Array<{ userId: string; name: string }>;
};

const EVENT_LABELS: Record<string, string> = {
  created: 'Anfrage erfasst',
  updated: 'Anfrage bearbeitet',
  status_changed: 'Status geändert',
  matched: 'Kunde zugeordnet',
  promoted: 'Als neuer Kunde angelegt',
  converted_to_service_case: 'Als Servicefall übernommen',
  converted: 'Umgewandelt',
  closed: 'Geschlossen',
  reopened: 'Wieder geöffnet',
};

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function RequestDetailContent({ data }: { data: RequestDetailData }) {
  const router = useRouter();
  const { request } = data;
  const { run: runPendingTask, isPending } = usePendingTask();
  const { showBanner } = useBanner();
  const [convertOpen, setConvertOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchClientId, setMatchClientId] = useState('');
  const [matchSiteId, setMatchSiteId] = useState('');
  const [matchContactId, setMatchContactId] = useState('');

  useRealtimeRouterRefresh({
    tables: ['client_requests', 'documents', 'document_links'],
  });

  const isEditable = request.status === 'offen' || request.status === 'in_klaerung';

  function showFeedback(variant: 'success' | 'error', message: string) {
    showBanner({ variant, message });
  }

  function handleStatusToggle() {
    const nextStatus = request.status === 'offen' ? 'in_klaerung' : 'offen';
    void runPendingTask(async () => {
      const result = await updateClientRequest(request.id, { status: nextStatus });
      if (!result.success) {
        showFeedback('error', 'Der Status konnte nicht geändert werden.');
        return;
      }
      router.refresh();
    });
  }

  function handleReopen() {
    void runPendingTask(async () => {
      const result = await reopenClientRequest(request.id);
      if (!result.success) {
        showFeedback('error', 'Die Anfrage konnte nicht wieder geöffnet werden.');
        return;
      }
      showFeedback('success', 'Anfrage wurde wieder geöffnet.');
      router.refresh();
    });
  }

  function handlePromote() {
    void runPendingTask(async () => {
      const result = await promoteCallerToClient(request.id);
      if (!result.success) {
        showFeedback(
          'error',
          result.error === 'caller_name_required'
            ? 'Zum Anlegen wird mindestens der Name der Anruferin / des Anrufers benötigt.'
            : 'Der Kunde konnte nicht angelegt werden.'
        );
        return;
      }
      showFeedback('success', 'Kunde wurde angelegt und der Anfrage zugeordnet.');
      router.refresh();
    });
  }

  function handleMatchConfirm() {
    if (!matchClientId) return;
    void runPendingTask(async () => {
      const result = await updateClientRequest(request.id, {
        clientId: matchClientId,
        siteId: matchSiteId || null,
        contactId: matchContactId || null,
      });
      if (!result.success) {
        showFeedback('error', 'Der Kunde konnte nicht zugeordnet werden.');
        return;
      }
      setMatchOpen(false);
      setMatchClientId('');
      setMatchSiteId('');
      setMatchContactId('');
      showFeedback('success', 'Kunde wurde zugeordnet.');
      router.refresh();
    });
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/anfragen">
            <ArrowLeft className="size-4" />
            Zurück zu Anfragen
          </Link>
        </Button>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {request.requestNumber && (
                <span className="font-mono text-sm text-muted-foreground">
                  {request.requestNumber}
                </span>
              )}
              <RequestStatusBadge status={request.status} />
              <RequestUrgencyBadge urgency={request.urgency} />
            </div>
            <h1 className="mt-1 text-xl font-bold sm:text-2xl">{request.summary}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {REQUEST_CATEGORY_LABELS[request.category]} ·{' '}
              {REQUEST_SOURCE_LABELS[request.source]} · Eingegangen am{' '}
              {formatDateTime(request.receivedAt)}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            {isEditable && (
              <>
                <Button
                  size="sm"
                  onClick={() => setConvertOpen(true)}
                  disabled={isPending}
                >
                  <ArrowRightLeft className="size-4" />
                  Umwandeln
                </Button>
                <ConvertRequestToServiceDialog
                  requestId={request.id}
                  enabled={Boolean(request.clientId && request.siteId)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditOpen(true)}
                  disabled={isPending}
                >
                  <Pencil className="size-4" />
                  Bearbeiten
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleStatusToggle}
                  disabled={isPending}
                >
                  {request.status === 'offen'
                    ? 'In Klärung setzen'
                    : 'Zurück auf Offen'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCloseOpen(true)}
                  disabled={isPending}
                >
                  <XCircle className="size-4" />
                  Schließen
                </Button>
              </>
            )}
            {request.status === 'geschlossen' && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleReopen}
                disabled={isPending}
              >
                <RotateCcw className="size-4" />
                Wieder öffnen
              </Button>
            )}
          </div>
        </div>
      </div>

      {data.convertedLink && (
        <div className="flex items-center gap-2 rounded-lg border bg-card p-4">
          <CircleCheck className="size-5 shrink-0 text-green-600 dark:text-green-400" />
          <p className="text-sm">
            Diese Anfrage wurde umgewandelt:{' '}
            {data.convertedLink.href ? (
              <Link
                href={data.convertedLink.href}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {data.convertedLink.label}
              </Link>
            ) : (
              <span className="font-medium">{data.convertedLink.label}</span>
            )}
          </p>
        </div>
      )}

      {request.status === 'geschlossen' && request.closedReason && (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm">
            <span className="font-medium">Ohne Auftrag geschlossen:</span>{' '}
            {REQUEST_CLOSE_REASON_LABELS[request.closedReason]}
            {request.closedAt ? ` (${formatDateTime(request.closedAt)})` : ''}
          </p>
          {request.closedNote && (
            <p className="mt-1 text-sm text-muted-foreground">{request.closedNote}</p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Customer / caller context */}
        <div className="rounded-lg border bg-card p-4 sm:p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Building2 className="size-4" />
            Kunde
          </h2>
          {request.clientId && data.clientName ? (
            <div className="mt-3 space-y-1.5 text-sm">
              <Link
                href={`/kunden/${request.clientId}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {data.clientName}
              </Link>
              {data.siteLabel && (
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Einsatzort:</span>{' '}
                  {data.siteLabel}
                </p>
              )}
              {data.contactLabel && (
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Ansprechpartner:</span>{' '}
                  {data.contactLabel}
                  {data.contactPhone && (
                    <>
                      {' · '}
                      <a
                        href={`tel:${data.contactPhone.replace(/[^\d+]/g, '')}`}
                        className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                      >
                        <Phone className="size-3.5" />
                        {data.contactPhone}
                      </a>
                    </>
                  )}
                </p>
              )}
              {(request.callerName ||
                request.callerPhone ||
                request.callerEmail ||
                request.callerAddress) && (
                <div className="mt-3 border-t pt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Erfasste Anruferdaten
                  </p>
                  <div className="mt-1 space-y-1">
                    {request.callerName && <p>{request.callerName}</p>}
                    {request.callerPhone && (
                      <p className="text-muted-foreground">{request.callerPhone}</p>
                    )}
                    {request.callerEmail && (
                      <p className="text-muted-foreground">{request.callerEmail}</p>
                    )}
                    {request.callerAddress && (
                      <p className="text-muted-foreground">{request.callerAddress}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="space-y-1 text-sm">
                <p className="font-medium">
                  {request.callerName || 'Unbekannte/r Anrufer/in'}
                </p>
                {request.callerPhone && (
                  <p className="text-muted-foreground">{request.callerPhone}</p>
                )}
                {request.callerEmail && (
                  <p className="text-muted-foreground">{request.callerEmail}</p>
                )}
                {request.callerAddress && (
                  <p className="text-muted-foreground">{request.callerAddress}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Noch keinem Kunden zugeordnet.
                </p>
              </div>
              {isEditable && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setMatchOpen(true)}
                    disabled={isPending}
                  >
                    Vorhandenem Kunden zuordnen
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handlePromote}
                    disabled={isPending || !request.callerName}
                  >
                    {isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <UserPlus className="size-4" />
                    )}
                    Als neuen Kunden anlegen
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Request facts */}
        <div className="rounded-lg border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Details
          </h2>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted-foreground">Zuständig</dt>
              <dd>{data.assigneeName || '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted-foreground">Kategorie</dt>
              <dd>{REQUEST_CATEGORY_LABELS[request.category]}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted-foreground">Eingang über</dt>
              <dd>{REQUEST_SOURCE_LABELS[request.source]}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted-foreground">Eingegangen</dt>
              <dd>{formatDateTime(request.receivedAt)}</dd>
            </div>
          </dl>
          {request.details && (
            <div className="mt-3 border-t pt-3">
              <p className="whitespace-pre-wrap text-sm">{request.details}</p>
            </div>
          )}
        </div>
      </div>

      <ContextualDocumentsSection
        title="Dokumente & Bilder"
        description="Fotos, Nachrichten oder Unterlagen zur Anfrage. Bei einer Umwandlung werden sie automatisch mit dem Auftrag oder Projekt verknüpft."
        documents={data.documents}
        requestId={request.id}
        canUpload={isEditable}
        canManage
      />

      {/* History */}
      <div className="rounded-lg border bg-card p-4 sm:p-5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <History className="size-4" />
          Verlauf
        </h2>
        {data.events.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Noch keine Einträge.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.events.map((event) => (
              <li key={event.id} className="flex items-baseline gap-2 text-sm">
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {formatDateTime(event.createdAt)}
                </span>
                <span>
                  {EVENT_LABELS[event.eventType] ?? event.eventType}
                  {event.actorName ? (
                    <span className="text-muted-foreground"> · {event.actorName}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConvertRequestDialog
        request={request}
        clients={data.clients}
        open={convertOpen}
        onOpenChange={setConvertOpen}
      />

      <CloseRequestDialog
        requestId={request.id}
        open={closeOpen}
        onOpenChange={setCloseOpen}
      />

      <EditRequestDialog
        request={request}
        assignees={data.assignees}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      {/* Match an existing customer to an unknown-caller request */}
      <Dialog
        open={matchOpen}
        onOpenChange={(open) => {
          setMatchOpen(open);
          if (!open) {
            setMatchClientId('');
            setMatchSiteId('');
            setMatchContactId('');
          }
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Kunden zuordnen</DialogTitle>
            <DialogDescription>
              Die erfassten Anruferdaten bleiben zur Nachvollziehbarkeit an der
              Anfrage erhalten.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Kunde</Label>
              <ClientSelectWithCreate
                clients={data.clients}
                value={matchClientId}
                onValueChange={(value) => {
                  setMatchClientId(value);
                  setMatchSiteId('');
                  setMatchContactId('');
                }}
                disabled={isPending}
              />
            </div>
            {matchClientId && (
              <SiteContactFields
                clientId={matchClientId}
                siteId={matchSiteId}
                contactId={matchContactId}
                onSiteChange={(nextSiteId) => setMatchSiteId(nextSiteId)}
                onContactChange={setMatchContactId}
                disabled={isPending}
                idPrefix="match"
              />
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMatchOpen(false)}
              disabled={isPending}
            >
              Abbrechen
            </Button>
            <Button
              type="button"
              onClick={handleMatchConfirm}
              disabled={isPending || !matchClientId}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Zuordnen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
