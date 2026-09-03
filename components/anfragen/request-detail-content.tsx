'use client';

import { useState } from 'react';
import { usePendingTask } from '@/hooks/use-server-action';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
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

import { DetailPageHeader } from '@/components/shared/detail-page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { InlinePending } from '@/components/ui/inline-pending';
import { useBanner } from '@/components/ui/banner';
import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { ClientSelectWithCreate } from '@/components/auftraege/client-select-with-create';
import { SiteContactFields } from '@/components/auftraege/site-contact-fields';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
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
  // After a confirmed change the header keeps its indicator until the
  // refreshed request lands (settling), without disabling the actions.
  const { run: runSettle, isPending: isSettling } = usePendingTask();
  const waitForChange = useSettleOnChange(request);
  const { showBanner } = useBanner();
  const [convertOpen, setConvertOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchClientId, setMatchClientId] = useState('');
  const [matchSiteId, setMatchSiteId] = useState('');
  const [matchContactId, setMatchContactId] = useState('');
  // Failures render where the action was taken: header, customer card, dialog.
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);

  useRealtimeRouterRefresh({
    tables: ['client_requests', 'documents', 'document_links'],
  });

  const isEditable = request.status === 'offen' || request.status === 'in_klaerung';

  function markSettling() {
    void runSettle(waitForChange);
  }

  function changeStatus(
    nextStatus: 'offen' | 'in_klaerung',
    previousStatus: 'offen' | 'in_klaerung'
  ) {
    setHeaderError(null);
    void runPendingTask(async () => {
      const result = await updateClientRequest(request.id, { status: nextStatus });
      if (!result.success) {
        setHeaderError('Der Status konnte nicht geändert werden.');
        return;
      }
      showBanner({
        variant: 'success',
        message:
          nextStatus === 'in_klaerung'
            ? 'Anfrage ist jetzt in Klärung.'
            : 'Anfrage ist wieder offen.',
        actionLabel: 'Rückgängig',
        onAction: () => changeStatus(previousStatus, nextStatus),
      });
      router.refresh();
      markSettling();
    });
  }

  function handleStatusToggle() {
    if (request.status !== 'offen' && request.status !== 'in_klaerung') return;
    changeStatus(request.status === 'offen' ? 'in_klaerung' : 'offen', request.status);
  }

  function handleReopen() {
    setHeaderError(null);
    void runPendingTask(async () => {
      const result = await reopenClientRequest(request.id);
      if (!result.success) {
        setHeaderError('Die Anfrage konnte nicht wieder geöffnet werden.');
        return;
      }
      showBanner({ variant: 'success', message: 'Anfrage wurde wieder geöffnet.' });
      router.refresh();
      markSettling();
    });
  }

  function handlePromote() {
    setPromoteError(null);
    void runPendingTask(async () => {
      const result = await promoteCallerToClient(request.id);
      if (!result.success) {
        setPromoteError(
          result.error === 'caller_name_required'
            ? 'Zum Anlegen wird mindestens der Name der Anruferin / des Anrufers benötigt.'
            : 'Der Kunde konnte nicht angelegt werden.'
        );
        return;
      }
      showBanner({
        variant: 'success',
        message: 'Kunde wurde angelegt und der Anfrage zugeordnet.',
      });
      router.refresh();
      markSettling();
    });
  }

  function handleMatchConfirm() {
    if (!matchClientId) return;
    setMatchError(null);
    void runPendingTask(async () => {
      const result = await updateClientRequest(request.id, {
        clientId: matchClientId,
        siteId: matchSiteId || null,
        contactId: matchContactId || null,
      });
      if (!result.success) {
        setMatchError('Der Kunde konnte nicht zugeordnet werden.');
        return;
      }
      setMatchOpen(false);
      setMatchClientId('');
      setMatchSiteId('');
      setMatchContactId('');
      showBanner({ variant: 'success', message: 'Kunde wurde zugeordnet.' });
      router.refresh();
      markSettling();
    });
  }

  return (
    <PageShell>
      <DetailPageHeader
        breadcrumbs={[
          { label: 'Anfragen', href: '/anfragen' },
          { label: request.requestNumber || 'Anfrage' },
        ]}
        title={request.summary}
        subtitle={`${REQUEST_CATEGORY_LABELS[request.category]} · ${REQUEST_SOURCE_LABELS[request.source]} · Eingegangen am ${formatDateTime(request.receivedAt)}`}
        badges={
          <>
            <RequestStatusBadge status={request.status} />
            <RequestUrgencyBadge urgency={request.urgency} />
          </>
        }
        actions={
          <>
            <InlinePending
              active={isPending || isSettling}
              label="Anfrage wird gespeichert"
            />
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
          </>
        }
      />
      {headerError ? (
        <ErrorText className="mx-4 mt-4 sm:mx-6">{headerError}</ErrorText>
      ) : null}

      <PageBody maxWidth="content">
        <div className="space-y-4">
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
                  <ErrorText>{promoteError}</ErrorText>
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
            documentTarget={{ kind: "request", requestId: request.id }}
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
        </div>
      </PageBody>

      <ConvertRequestDialog
        request={request}
        clients={data.clients}
        open={convertOpen}
        onOpenChange={setConvertOpen}
        onSaved={markSettling}
      />

      <CloseRequestDialog
        requestId={request.id}
        open={closeOpen}
        onOpenChange={setCloseOpen}
        onSaved={markSettling}
      />

      <EditRequestDialog
        request={request}
        assignees={data.assignees}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={markSettling}
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
            setMatchError(null);
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
            <Field label="Kunde" htmlFor="match-client" required>
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
            </Field>
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
            <ErrorText>{matchError}</ErrorText>
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
    </PageShell>
  );
}
