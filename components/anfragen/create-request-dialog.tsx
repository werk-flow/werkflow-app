'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { DateTimeField } from '@/components/ui/date-time-field';
import { ErrorText } from '@/components/ui/error-text';
import { Separator } from '@/components/ui/separator';
import { useBanner } from '@/components/ui/banner';
import { ClientSelectWithCreate } from '@/components/auftraege/client-select-with-create';
import { SiteContactFields } from '@/components/auftraege/site-contact-fields';
import {
  formatBerlinDateTimeInput,
  parseBerlinDateTimeInput,
} from '@/lib/customer-relationships/date-time';
import {
  createClientRequest,
  getNextRequestNumber,
  type CreateClientRequestInput,
} from '@/lib/requests/actions';
import {
  REQUEST_CATEGORY_LABELS,
  REQUEST_CATEGORY_ORDER,
  REQUEST_SOURCE_LABELS,
  REQUEST_SOURCE_ORDER,
  REQUEST_URGENCY_LABELS,
  REQUEST_URGENCY_ORDER,
  type RequestCategory,
  type RequestSource,
  type RequestUrgency,
} from '@/lib/requests/types';
import type { Client } from '@/lib/jobs/types';

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Du bist nicht angemeldet.',
  no_active_org: 'Keine Organisation ausgewählt.',
  not_authorized: 'Du bist nicht berechtigt, Anfragen zu verwalten.',
  summary_required: 'Bitte beschreibe kurz das Anliegen.',
  request_number_taken: 'Diese Anfragenummer ist bereits vergeben.',
  invalid_received_at: 'Bitte gib eine gültige Eingangszeit ein.',
  client_not_found: 'Der Kunde wurde nicht gefunden.',
  create_failed: 'Fehler beim Speichern der Anfrage.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.',
};

export type RequestAssigneeOption = {
  userId: string;
  name: string;
};

interface CreateRequestDialogProps {
  clients: Client[];
  assignees: RequestAssigneeOption[];
}

export function CreateRequestDialog({ clients, assignees }: CreateRequestDialogProps) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [open, setOpen] = useState(false);

  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [requestNumber, setRequestNumber] = useState('');
  const requestNumberEditedRef = useRef(false);
  const [clientId, setClientId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [contactId, setContactId] = useState('');
  const [callerName, setCallerName] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const [callerEmail, setCallerEmail] = useState('');
  const [callerAddress, setCallerAddress] = useState('');
  const [category, setCategory] = useState<RequestCategory>('sonstiges');
  const [urgency, setUrgency] = useState<RequestUrgency>('normal');
  const [source, setSource] = useState<RequestSource>('telefon');
  const [receivedAt, setReceivedAt] = useState(() =>
    formatBerlinDateTimeInput(new Date())
  );
  const [assignedTo, setAssignedTo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  // Suggest the next free number when the dialog opens; the field stays
  // editable. The suggestion must never overwrite a number the user has
  // already typed while the fetch was in flight.
  useEffect(() => {
    if (!open) return;
    let isCurrent = true;
    getNextRequestNumber()
      .then((result) => {
        if (isCurrent && result.success && !requestNumberEditedRef.current) {
          setRequestNumber((current) => current || result.requestNumber);
        }
      })
      .catch(() => undefined);
    return () => {
      isCurrent = false;
    };
  }, [open]);

  const resetForm = () => {
    requestNumberEditedRef.current = false;
    setSummary('');
    setDetails('');
    setRequestNumber('');
    setClientId('');
    setSiteId('');
    setContactId('');
    setCallerName('');
    setCallerPhone('');
    setCallerEmail('');
    setCallerAddress('');
    setCategory('sonstiges');
    setUrgency('normal');
    setSource('telefon');
    setReceivedAt(formatBerlinDateTimeInput(new Date()));
    setAssignedTo('');
    setHasAttemptedSubmit(false);
    setError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setReceivedAt(formatBerlinDateTimeInput(new Date()));
    } else {
      resetForm();
    }
  };

  const handleClientChange = (nextClientId: string) => {
    setClientId(nextClientId);
    setSiteId('');
    setContactId('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);

    if (!summary.trim()) return;

    const receivedAtDate = receivedAt
      ? parseBerlinDateTimeInput(receivedAt)
      : null;
    if (receivedAt && !receivedAtDate) {
      setError(ERROR_MESSAGES.invalid_received_at);
      return;
    }

    setIsLoading(true);
    try {
      const input: CreateClientRequestInput = {
        summary: summary.trim(),
        details: details.trim() || undefined,
        requestNumber: requestNumber.trim() || undefined,
        clientId: clientId || undefined,
        siteId: siteId || undefined,
        contactId: contactId || undefined,
        callerName: callerName.trim() || undefined,
        callerPhone: callerPhone.trim() || undefined,
        callerEmail: callerEmail.trim() || undefined,
        callerAddress: callerAddress.trim() || undefined,
        category,
        urgency,
        source,
        receivedAt: receivedAtDate?.toISOString(),
        assignedTo: assignedTo || undefined,
      };

      const result = await createClientRequest(input);
      if (!result.success) {
        setError(ERROR_MESSAGES[result.error] || 'Unbekannter Fehler');
        return;
      }

      handleOpenChange(false);
      showBanner({ variant: 'success', message: 'Anfrage wurde erfasst.' });
      router.push(`/anfragen/${result.request.id}`);
      router.refresh();
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setIsLoading(false);
    }
  };

  const showSummaryError = hasAttemptedSubmit && !summary.trim();
  const showReceivedAtError = error === ERROR_MESSAGES.invalid_received_at;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="default" className="gap-2">
          <Plus className="size-4" />
          <span className="hidden sm:inline">Anfrage erfassen</span>
          <span className="sm:hidden">Erfassen</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-[520px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Neue Anfrage erfassen</DialogTitle>
          <DialogDescription>
            Halte das Anliegen direkt während des Gesprächs fest. Nur die
            Beschreibung ist Pflicht – alles andere kannst du später ergänzen.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.stopPropagation(); handleSubmit(e); }}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="request-summary">Anliegen *</Label>
              <Input
                id="request-summary"
                placeholder="z. B. Heizung fällt aus, kein Warmwasser"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                disabled={isLoading}
                aria-invalid={showSummaryError ? true : undefined}
                autoFocus
              />
              <ErrorText>
                {showSummaryError ? 'Bitte beschreibe kurz das Anliegen.' : null}
              </ErrorText>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="request-category">Kategorie</Label>
                <Select
                  value={category}
                  onValueChange={(value) => setCategory(value as RequestCategory)}
                  disabled={isLoading}
                >
                  <SelectTrigger id="request-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REQUEST_CATEGORY_ORDER.map((value) => (
                      <SelectItem key={value} value={value}>
                        {REQUEST_CATEGORY_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="request-urgency">Dringlichkeit</Label>
                <Select
                  value={urgency}
                  onValueChange={(value) => setUrgency(value as RequestUrgency)}
                  disabled={isLoading}
                >
                  <SelectTrigger id="request-urgency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REQUEST_URGENCY_ORDER.map((value) => (
                      <SelectItem key={value} value={value}>
                        {REQUEST_URGENCY_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="request-received-at-date">Eingangszeit</Label>
              <DateTimeField
                idPrefix="request-received-at"
                value={receivedAt}
                onChange={setReceivedAt}
                disabled={isLoading}
                dateAriaLabel="Eingangsdatum"
                invalid={showReceivedAtError}
                describedById={
                  showReceivedAtError ? 'request-received-at-error' : undefined
                }
              />
              <ErrorText id="request-received-at-error" className="text-xs">
                {showReceivedAtError ? ERROR_MESSAGES.invalid_received_at : null}
              </ErrorText>
            </div>

            <Separator />
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Kunde
            </p>

            <div className="grid gap-2">
              <Label htmlFor="request-client">Kunde</Label>
              <ClientSelectWithCreate
                clients={clients}
                value={clientId}
                onValueChange={handleClientChange}
                disabled={isLoading}
              />
              {!clientId && (
                <p className="text-xs text-muted-foreground">
                  Unbekannte Anrufer kannst du unten festhalten und später einem
                  Kunden zuordnen.
                </p>
              )}
            </div>

            {clientId ? (
              <SiteContactFields
                clientId={clientId}
                siteId={siteId}
                contactId={contactId}
                onSiteChange={(nextSiteId) => setSiteId(nextSiteId)}
                onContactChange={setContactId}
                disabled={isLoading}
                idPrefix="request"
              />
            ) : (
              <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Anrufer/in (noch kein Kunde)
                </p>
                <div className="grid gap-2">
                  <Label htmlFor="request-caller-name">Name</Label>
                  <Input
                    id="request-caller-name"
                    placeholder="Name der Anruferin / des Anrufers"
                    value={callerName}
                    onChange={(e) => setCallerName(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="request-caller-phone">Telefon</Label>
                    <Input
                      id="request-caller-phone"
                      type="tel"
                      placeholder="+49 123 456789"
                      value={callerPhone}
                      onChange={(e) => setCallerPhone(e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="request-caller-email">E-Mail</Label>
                    <Input
                      id="request-caller-email"
                      type="text"
                      inputMode="email"
                      placeholder="name@beispiel.de"
                      value={callerEmail}
                      onChange={(e) => setCallerEmail(e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="request-caller-address">Adresse</Label>
                  <Input
                    id="request-caller-address"
                    placeholder="Straße, PLZ Ort"
                    value={callerAddress}
                    onChange={(e) => setCallerAddress(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
              </div>
            )}

            <Separator />
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Weitere Angaben
            </p>

            <div className="grid gap-2">
              <Label htmlFor="request-details">Details</Label>
              <Textarea
                id="request-details"
                placeholder="Weitere Angaben aus dem Gespräch..."
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="request-source">Eingang über</Label>
                <Select
                  value={source}
                  onValueChange={(value) => setSource(value as RequestSource)}
                  disabled={isLoading}
                >
                  <SelectTrigger id="request-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REQUEST_SOURCE_ORDER.map((value) => (
                      <SelectItem key={value} value={value}>
                        {REQUEST_SOURCE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="request-number">Anfragenummer</Label>
                <Input
                  id="request-number"
                  placeholder="ANF-2026-001"
                  value={requestNumber}
                  onChange={(event) => {
                    requestNumberEditedRef.current = true;
                    setRequestNumber(event.target.value);
                  }}
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="request-assignee">Zuständig</Label>
              <SearchableSelect
                id="request-assignee"
                options={assignees.map((assignee) => ({
                  value: assignee.userId,
                  label: assignee.name,
                }))}
                value={assignedTo}
                onChange={setAssignedTo}
                placeholder="Niemand zuständig"
                searchPlaceholder="Mitarbeiter suchen..."
                emptyMessage="Kein Mitarbeiter gefunden"
                allowNone
                noneLabel="Niemand zuständig"
                disabled={isLoading}
              />
            </div>

            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter className="pt-4">
            <Button type="submit" disabled={isLoading || !summary.trim()}>
              {isLoading && <Loader2 className="size-4 animate-spin" />}
              {isLoading ? 'Wird gespeichert...' : 'Anfrage erfassen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
