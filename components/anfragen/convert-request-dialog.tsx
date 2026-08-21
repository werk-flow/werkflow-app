'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightLeft, Loader2 } from 'lucide-react';

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
import { DatePicker } from '@/components/ui/date-picker';
import { TimeInput } from '@/components/ui/time-input';
import { ErrorText } from '@/components/ui/error-text';
import { useBanner } from '@/components/ui/banner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ClientSelectWithCreate } from '@/components/auftraege/client-select-with-create';
import { SiteContactFields } from '@/components/auftraege/site-contact-fields';
import { toLocalDateString } from '@/lib/utils';
import { getNextJobNumber } from '@/lib/jobs/actions';
import { getNextProjectNumber } from '@/lib/projects/actions';
import {
  convertRequestToJob,
  convertRequestToProject,
} from '@/lib/requests/actions';
import {
  requestUrgencyToJobPriority,
  type ClientRequest,
} from '@/lib/requests/types';
import {
  JOB_PRIORITY_LABELS,
  type Client,
  type JobPriority,
} from '@/lib/jobs/types';

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Du bist nicht angemeldet.',
  no_active_org: 'Keine Organisation ausgewählt.',
  not_authorized: 'Du bist nicht berechtigt, Anfragen umzuwandeln.',
  request_not_found: 'Die Anfrage wurde nicht gefunden.',
  already_converted: 'Diese Anfrage wurde bereits umgewandelt.',
  client_required: 'Bitte wähle einen Kunden aus oder lege ihn an.',
  job_number_required: 'Bitte gib eine Auftragsnummer ein.',
  job_number_taken: 'Diese Auftragsnummer ist bereits vergeben.',
  project_number_taken: 'Diese Projektnummer ist bereits vergeben.',
  title_or_description_required: 'Bitte gib einen Titel ein.',
  name_required: 'Bitte gib einen Projektnamen ein.',
  create_failed: 'Die Umwandlung ist fehlgeschlagen.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.',
};

type ConversionTarget = 'job' | 'project';

interface ConvertRequestDialogProps {
  request: ClientRequest;
  clients: Client[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Deliberate once-only conversion: everything the request captured is
// prefilled and stays editable; nothing is scheduled or assigned implicitly.
export function ConvertRequestDialog({
  request,
  clients,
  open,
  onOpenChange,
}: ConvertRequestDialogProps) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [target, setTarget] = useState<ConversionTarget>('job');
  const [title, setTitle] = useState(request.summary);
  const [description, setDescription] = useState(request.details ?? '');
  const [number, setNumber] = useState('');
  const [clientId, setClientId] = useState(request.clientId ?? '');
  const [siteId, setSiteId] = useState(request.siteId ?? '');
  const [contactId, setContactId] = useState(request.contactId ?? '');
  const [priority, setPriority] = useState<JobPriority>(
    requestUrgencyToJobPriority(request.urgency)
  );
  const [plannedDate, setPlannedDate] = useState('');
  const [plannedTime, setPlannedTime] = useState('');
  const [location, setLocation] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill from the request each time the dialog opens. Keyed on open and
  // request.id only: Realtime refreshes replace the request object with equal
  // content, and re-running the effect would wipe the user's in-dialog edits.
  useEffect(() => {
    if (!open) return;
    setTitle(request.summary);
    setDescription(request.details ?? '');
    setClientId(request.clientId ?? '');
    setSiteId(request.siteId ?? '');
    setContactId(request.contactId ?? '');
    setPriority(requestUrgencyToJobPriority(request.urgency));
    setPlannedDate('');
    setPlannedTime('');
    setLocation('');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request.id]);

  const lastSuggestedNumberRef = useRef('');

  useEffect(() => {
    if (!open) return;
    let isCurrent = true;
    const fetchNumber =
      target === 'job' ? getNextJobNumber() : getNextProjectNumber();
    fetchNumber
      .then((result) => {
        if (!isCurrent || !result.success) return;
        const suggestion =
          'jobNumber' in result ? result.jobNumber : result.projectNumber;
        // Apply the suggestion only when the field is empty or still holds a
        // previous suggestion — never overwrite a number the user typed.
        setNumber((current) => {
          if (current && current !== lastSuggestedNumberRef.current) {
            return current;
          }
          lastSuggestedNumberRef.current = suggestion;
          return suggestion;
        });
      })
      .catch(() => undefined);
    return () => {
      isCurrent = false;
    };
  }, [open, target]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!clientId) {
      setError(ERROR_MESSAGES.client_required);
      return;
    }

    setIsLoading(true);
    try {
      if (target === 'job') {
        const result = await convertRequestToJob(request.id, {
          title: title.trim(),
          description: description.trim() || undefined,
          clientId,
          siteId: siteId || undefined,
          contactId: contactId || undefined,
          jobNumber: number.trim(),
          priority,
          plannedDate: plannedDate || undefined,
          plannedTime: plannedTime || undefined,
          location: location.trim() || undefined,
        });
        if (!result.success) {
          setError(ERROR_MESSAGES[result.error] || 'Unbekannter Fehler');
          return;
        }
        onOpenChange(false);
        showBanner({
          variant: 'success',
          message: 'Anfrage wurde in einen Auftrag umgewandelt.',
        });
        router.refresh();
      } else {
        const result = await convertRequestToProject(request.id, {
          name: title.trim(),
          description: description.trim() || undefined,
          clientId,
          siteId: siteId || undefined,
          contactId: contactId || undefined,
          projectNumber: number.trim() || undefined,
        });
        if (!result.success) {
          setError(ERROR_MESSAGES[result.error] || 'Unbekannter Fehler');
          return;
        }
        onOpenChange(false);
        showBanner({
          variant: 'success',
          message: 'Anfrage wurde in ein Projekt umgewandelt.',
        });
        router.refresh();
      }
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[520px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Anfrage umwandeln</DialogTitle>
          <DialogDescription>
            Die Angaben aus der Anfrage sind übernommen und bleiben mit der
            Anfrage verknüpft. Eine Anfrage kann nur einmal umgewandelt werden.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-2">
            <Tabs
              value={target}
              onValueChange={(value) => setTarget(value as ConversionTarget)}
            >
              <TabsList className="h-9 w-full">
                <TabsTrigger value="job" className="flex-1">
                  Auftrag
                </TabsTrigger>
                <TabsTrigger value="project" className="flex-1">
                  Projekt
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="grid gap-2">
              <Label htmlFor="convert-title">
                {target === 'job' ? 'Titel *' : 'Projektname *'}
              </Label>
              <Input
                id="convert-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="convert-number">
                {target === 'job' ? 'Auftragsnummer *' : 'Projektnummer'}
              </Label>
              <Input
                id="convert-number"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="convert-client">Kunde *</Label>
              <ClientSelectWithCreate
                clients={clients}
                value={clientId}
                onValueChange={(nextClientId) => {
                  setClientId(nextClientId);
                  setSiteId('');
                  setContactId('');
                }}
                disabled={isLoading}
              />
              {!request.clientId && (
                <p className="text-xs text-muted-foreground">
                  Die Anfrage kam von {request.callerName || 'einem unbekannten Anrufer'}.
                  Wähle den passenden Kunden oder lege ihn neu an.
                </p>
              )}
            </div>

            {clientId && (
              <SiteContactFields
                clientId={clientId}
                siteId={siteId}
                contactId={contactId}
                onSiteChange={(nextSiteId, site) => {
                  setSiteId(nextSiteId);
                  if (target === 'job' && site) {
                    const cityLine = [site.postalCode, site.city]
                      .filter(Boolean)
                      .join(' ');
                    setLocation(
                      [site.street, cityLine].filter(Boolean).join(', ')
                    );
                  }
                }}
                onContactChange={setContactId}
                disabled={isLoading}
                idPrefix="convert"
              />
            )}

            {target === 'job' && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="convert-location">Ort</Label>
                  <Input
                    id="convert-location"
                    placeholder="Straße, PLZ Ort"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="convert-priority">Priorität</Label>
                    <Select
                      value={priority}
                      onValueChange={(value) => setPriority(value as JobPriority)}
                      disabled={isLoading}
                    >
                      <SelectTrigger id="convert-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(JOB_PRIORITY_LABELS) as JobPriority[]).map(
                          (value) => (
                            <SelectItem key={value} value={value}>
                              {JOB_PRIORITY_LABELS[value]}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="convert-date">Geplantes Datum</Label>
                    <DatePicker
                      id="convert-date"
                      ariaLabel="Geplantes Datum"
                      value={
                        plannedDate
                          ? new Date(
                              Number(plannedDate.slice(0, 4)),
                              Number(plannedDate.slice(5, 7)) - 1,
                              Number(plannedDate.slice(8, 10))
                            )
                          : undefined
                      }
                      onChange={(date) =>
                        setPlannedDate(date ? toLocalDateString(date) : '')
                      }
                      disabled={isLoading}
                    />
                  </div>
                </div>
                {plannedDate && (
                  <div className="grid gap-2">
                    <Label htmlFor="convert-time">Geplante Uhrzeit</Label>
                    <TimeInput
                      id="convert-time"
                      value={plannedTime}
                      onChange={setPlannedTime}
                      disabled={isLoading}
                    />
                  </div>
                )}
                {!plannedDate && (
                  <p className="text-xs text-muted-foreground">
                    Ohne Datum landet der Auftrag im Parkplatz und kann später
                    eingeplant werden. Es wird nichts automatisch terminiert.
                  </p>
                )}
              </>
            )}

            <div className="grid gap-2">
              <Label htmlFor="convert-description">Beschreibung</Label>
              <Textarea
                id="convert-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
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
            <Button
              type="submit"
              disabled={isLoading || !title.trim() || !clientId}
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRightLeft className="size-4" />
              )}
              {target === 'job'
                ? 'In Auftrag umwandeln'
                : 'In Projekt umwandeln'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
