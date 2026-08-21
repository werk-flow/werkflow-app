'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

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
import { useBanner } from '@/components/ui/banner';
import {
  formatBerlinDateTimeInput,
  parseBerlinDateTimeInput,
} from '@/lib/customer-relationships/date-time';
import { updateClientRequest } from '@/lib/requests/actions';
import {
  REQUEST_CATEGORY_LABELS,
  REQUEST_CATEGORY_ORDER,
  REQUEST_SOURCE_LABELS,
  REQUEST_SOURCE_ORDER,
  REQUEST_URGENCY_LABELS,
  REQUEST_URGENCY_ORDER,
  type ClientRequest,
  type RequestCategory,
  type RequestSource,
  type RequestUrgency,
} from '@/lib/requests/types';

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'Du bist nicht berechtigt, Anfragen zu bearbeiten.',
  request_not_found: 'Die Anfrage wurde nicht gefunden.',
  request_not_editable:
    'Diese Anfrage kann nicht mehr bearbeitet werden (bereits umgewandelt oder geschlossen).',
  summary_required: 'Bitte beschreibe kurz das Anliegen.',
  request_number_taken: 'Diese Anfragenummer ist bereits vergeben.',
  invalid_received_at: 'Bitte gib eine gültige Eingangszeit ein.',
  update_failed: 'Die Änderungen konnten nicht gespeichert werden.',
  no_changes: 'Es gibt keine Änderungen zu speichern.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.',
};

interface EditRequestDialogProps {
  request: ClientRequest;
  assignees: Array<{ userId: string; name: string }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditRequestDialog({
  request,
  assignees,
  open,
  onOpenChange,
}: EditRequestDialogProps) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [summary, setSummary] = useState(request.summary);
  const [details, setDetails] = useState(request.details ?? '');
  const [requestNumber, setRequestNumber] = useState(request.requestNumber ?? '');
  const [callerName, setCallerName] = useState(request.callerName ?? '');
  const [callerPhone, setCallerPhone] = useState(request.callerPhone ?? '');
  const [callerEmail, setCallerEmail] = useState(request.callerEmail ?? '');
  const [callerAddress, setCallerAddress] = useState(request.callerAddress ?? '');
  const [category, setCategory] = useState<RequestCategory>(request.category);
  const [urgency, setUrgency] = useState<RequestUrgency>(request.urgency);
  const [source, setSource] = useState<RequestSource>(request.source);
  const [receivedAt, setReceivedAt] = useState(
    formatBerlinDateTimeInput(request.receivedAt)
  );
  const [assignedTo, setAssignedTo] = useState(request.assignedTo ?? '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keyed on open and request.id only: Realtime refreshes replace the request
  // object with equal content, and re-running the effect would wipe edits.
  useEffect(() => {
    if (!open) return;
    setSummary(request.summary);
    setDetails(request.details ?? '');
    setRequestNumber(request.requestNumber ?? '');
    setCallerName(request.callerName ?? '');
    setCallerPhone(request.callerPhone ?? '');
    setCallerEmail(request.callerEmail ?? '');
    setCallerAddress(request.callerAddress ?? '');
    setCategory(request.category);
    setUrgency(request.urgency);
    setSource(request.source);
    setReceivedAt(formatBerlinDateTimeInput(request.receivedAt));
    setAssignedTo(request.assignedTo ?? '');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request.id]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!summary.trim()) {
      setError(ERROR_MESSAGES.summary_required);
      return;
    }

    const receivedAtDate = receivedAt
      ? parseBerlinDateTimeInput(receivedAt)
      : null;
    if (receivedAt && !receivedAtDate) {
      setError(ERROR_MESSAGES.invalid_received_at);
      return;
    }

    setIsLoading(true);
    try {
      const result = await updateClientRequest(request.id, {
        summary: summary.trim(),
        details,
        requestNumber,
        callerName,
        callerPhone,
        callerEmail,
        callerAddress,
        category,
        urgency,
        source,
        receivedAt: receivedAtDate?.toISOString(),
        assignedTo,
      });

      if (!result.success && result.error !== 'no_changes') {
        setError(ERROR_MESSAGES[result.error] || 'Unbekannter Fehler');
        return;
      }

      onOpenChange(false);
      showBanner({ variant: 'success', message: 'Änderungen gespeichert.' });
      router.refresh();
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setIsLoading(false);
    }
  };

  const showReceivedAtError = error === ERROR_MESSAGES.invalid_received_at;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[520px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Anfrage bearbeiten</DialogTitle>
          <DialogDescription>
            Änderungen werden im Verlauf der Anfrage festgehalten.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="edit-request-summary">Anliegen *</Label>
              <Input
                id="edit-request-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="edit-request-category">Kategorie</Label>
                <Select
                  value={category}
                  onValueChange={(value) => setCategory(value as RequestCategory)}
                  disabled={isLoading}
                >
                  <SelectTrigger id="edit-request-category">
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
                <Label htmlFor="edit-request-urgency">Dringlichkeit</Label>
                <Select
                  value={urgency}
                  onValueChange={(value) => setUrgency(value as RequestUrgency)}
                  disabled={isLoading}
                >
                  <SelectTrigger id="edit-request-urgency">
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
              <Label htmlFor="edit-request-received-at-date">Eingangszeit</Label>
              <DateTimeField
                idPrefix="edit-request-received-at"
                value={receivedAt}
                onChange={setReceivedAt}
                disabled={isLoading}
                dateAriaLabel="Eingangsdatum"
                invalid={showReceivedAtError}
                describedById={
                  showReceivedAtError
                    ? 'edit-request-received-at-error'
                    : undefined
                }
              />
              <ErrorText id="edit-request-received-at-error" className="text-xs">
                {showReceivedAtError ? ERROR_MESSAGES.invalid_received_at : null}
              </ErrorText>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-request-details">Details</Label>
              <Textarea
                id="edit-request-details"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {!request.clientId && (
              <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Anrufer/in (noch kein Kunde)
                </p>
                <div className="grid gap-2">
                  <Label htmlFor="edit-caller-name">Name</Label>
                  <Input
                    id="edit-caller-name"
                    value={callerName}
                    onChange={(e) => setCallerName(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="edit-caller-phone">Telefon</Label>
                    <Input
                      id="edit-caller-phone"
                      type="tel"
                      value={callerPhone}
                      onChange={(e) => setCallerPhone(e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-caller-email">E-Mail</Label>
                    <Input
                      id="edit-caller-email"
                      type="text"
                      inputMode="email"
                      value={callerEmail}
                      onChange={(e) => setCallerEmail(e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-caller-address">Adresse</Label>
                  <Input
                    id="edit-caller-address"
                    value={callerAddress}
                    onChange={(e) => setCallerAddress(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="edit-request-source">Eingang über</Label>
                <Select
                  value={source}
                  onValueChange={(value) => setSource(value as RequestSource)}
                  disabled={isLoading}
                >
                  <SelectTrigger id="edit-request-source">
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
                <Label htmlFor="edit-request-number">Anfragenummer</Label>
                <Input
                  id="edit-request-number"
                  value={requestNumber}
                  onChange={(e) => setRequestNumber(e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-request-assignee">Zuständig</Label>
              <SearchableSelect
                id="edit-request-assignee"
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
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={isLoading || !summary.trim()}>
              {isLoading && <Loader2 className="size-4 animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
