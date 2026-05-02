'use client';

import { useState, useTransition, useEffect, useMemo, useRef } from 'react';
import {
  Loader2,
  Clock,
  AlertCircle,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TimeInput } from '@/components/ui/time-input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { DatePicker } from '@/components/ui/date-picker';
import { useOrganization } from '@/components/organization/organization-context';
import {
  addManualEntry,
  getTimeEntries,
  getAssignedJobs,
  getAllOrgJobs
} from '@/lib/time-tracking/actions';
import { getOrgMembersAction } from '@/lib/members/actions';
import { validateManualEntries } from '@/lib/time-tracking/validation';
import type {
  ManualEntryInput,
  TimeEntry
} from '@/lib/time-tracking/types';
import { useUserProfile } from '@/components/user/user-profile-context';
import { toLocalDateString } from '@/lib/utils';

type EntryMode = 'clock_in' | 'clock_out' | 'both';

type OrgMember = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
};

type JobOption = {
  id: string;
  title: string;
  jobNumber: string | null;
  status: string;
  projectName: string | null;
};

export interface ManualEntryFormContentProps {
  onSuccess?: (entries: TimeEntry[]) => void | Promise<void>;
  preselectedUserId?: string;
  preselectedDate?: Date;
  preselectedClockInTime?: string;
  preselectedClockOutTime?: string;
  lockEntryMode?: boolean;
  /** Whether the form is active/visible. Controls data-fetching effects. Defaults to true. */
  isActive?: boolean;
}

export function ManualEntryFormContent({
  onSuccess,
  preselectedUserId,
  preselectedDate,
  preselectedClockInTime,
  preselectedClockOutTime,
  lockEntryMode,
  isActive = true,
}: ManualEntryFormContentProps) {
  const { activeOrgId, activeOrg } = useOrganization();
  const { profile } = useUserProfile();
  const [isPending, startTransition] = useTransition();

  const [entryMode, setEntryMode] = useState<EntryMode>('both');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    preselectedDate ?? new Date()
  );
  const [clockInTime, setClockInTime] = useState(preselectedClockInTime || '09:00');
  const [clockOutTime, setClockOutTime] = useState(preselectedClockOutTime || '17:00');
  const isAdminOrManager =
    activeOrg?.role === 'admin' || activeOrg?.role === 'buero';
  const currentUserId = profile?.id || null;
  const [selectedUserId, setSelectedUserId] = useState(
    preselectedUserId || (isAdminOrManager ? '' : currentUserId || '')
  );

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [jobOptions, setJobOptions] = useState<JobOption[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const canAssignJob =
    entryMode === 'clock_in' || entryMode === 'both';

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [otherOrgBanner, setOtherOrgBanner] = useState<null | {
    title: string;
    message: string;
  }>(null);
  const [isBannerExiting, setIsBannerExiting] = useState(false);
  const bannerTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isActive || !isAdminOrManager || !activeOrgId) return;
    const fetchMembers = async () => {
      setIsLoadingMembers(true);
      try {
        const result = await getOrgMembersAction(activeOrgId!);
        if (result.success) setMembers(result.members || []);
      } catch (err) {
        console.error('Error fetching members:', err);
      } finally {
        setIsLoadingMembers(false);
      }
    };
    fetchMembers();
  }, [isActive, isAdminOrManager, activeOrgId]);

  useEffect(() => {
    if (!isActive || !activeOrgId) return;
    const fetchJobs = async () => {
      setIsLoadingJobs(true);
      try {
        const result = isAdminOrManager
          ? await getAllOrgJobs(activeOrgId!)
          : await getAssignedJobs(activeOrgId!);
        if (result.success) setJobOptions(result.jobs);
      } catch (err) {
        console.error('Error fetching jobs:', err);
      } finally {
        setIsLoadingJobs(false);
      }
    };
    fetchJobs();
  }, [isActive, activeOrgId, isAdminOrManager]);

  useEffect(() => {
    if (canAssignJob) return;
    setSelectedJobId('');
  }, [canAssignJob]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setOtherOrgBanner(null);

    if (!activeOrgId) {
      setError('Keine Organisation ausgewählt.');
      return;
    }

    if (isAdminOrManager && !selectedUserId) {
      setError('Bitte wähle einen Mitarbeiter aus.');
      return;
    }

    const targetUserId = isAdminOrManager ? selectedUserId : currentUserId;
    if (!targetUserId) {
      setError('Keine Benutzerinformation verfügbar.');
      return;
    }

    if (!selectedDate) {
      setError('Bitte ein gültiges Datum wählen.');
      return;
    }

    const dateIso = toLocalDateString(selectedDate);
    const entries: ManualEntryInput[] = [];

    if (entryMode === 'clock_in' || entryMode === 'both') {
      const clockInTimestamp = new Date(
        `${dateIso}T${clockInTime}:00`
      ).toISOString();
      entries.push({ entryType: 'clock_in', timestamp: clockInTimestamp });
    }

    if (entryMode === 'clock_out' || entryMode === 'both') {
      const clockOutTimestamp = new Date(
        `${dateIso}T${clockOutTime}:00`
      ).toISOString();
      entries.push({ entryType: 'clock_out', timestamp: clockOutTimestamp });
    }

    startTransition(async () => {
      try {
        const dayStart = new Date(dateIso);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dateIso);
        dayEnd.setHours(23, 59, 59, 999);

        const existingResult = await getTimeEntries({
          organizationId: activeOrgId,
          from: dayStart.toISOString(),
          to: dayEnd.toISOString(),
          userId: targetUserId
        });

        let existingEntries: TimeEntry[] = [];
        if (existingResult.success) existingEntries = existingResult.entries;

        const validationResult = validateManualEntries(existingEntries, entries);
        if (!validationResult.valid) {
          setError(validationResult.error || 'Validierung fehlgeschlagen.');
          return;
        }

        const result = await addManualEntry({
          organizationId: activeOrgId,
          targetUserId,
          entries,
          jobId: canAssignJob ? selectedJobId || undefined : undefined
        });

        if (result.success) {
          const isPendingResult = result.entries.some((e) => e.status === 'pending');
          setSuccessMessage(
            isPendingResult
              ? 'Antrag wurde zur Genehmigung eingereicht.'
              : 'Eintrag erfolgreich erstellt!'
          );
          await onSuccess?.(result.entries);
          setTimeout(() => {
            setSuccessMessage(null);
          }, 1500);
        } else {
          if (
            result.error === 'working_in_other_org' &&
            'otherOrgName' in result &&
            typeof result.otherOrgName === 'string'
          ) {
            const isSelf = targetUserId === currentUserId;
            const title = isSelf
              ? 'Bereits in anderer Organisation eingestempelt'
              : 'Mitarbeiter ist bereits in anderer Organisation eingestempelt';
            const message = isSelf
              ? `Du bist aktuell in „${result.otherOrgName}" eingestempelt. Bitte stemple dort zuerst aus, bevor du hier startest.`
              : `Der ausgewählte Mitarbeiter ist aktuell in „${result.otherOrgName}" eingestempelt. Bitte zuerst dort ausstempeln, bevor hier eine offene Arbeitszeit gestartet wird.`;

            setOtherOrgBanner({ title, message });
            setError(message);

            if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
            bannerTimerRef.current = setTimeout(() => {
              setIsBannerExiting(true);
              setTimeout(() => {
                setIsBannerExiting(false);
                setOtherOrgBanner(null);
              }, 150);
            }, 6000);
          } else {
            setError(getErrorMessage(result.error));
          }
        }
      } catch (err) {
        console.error('Error submitting manual entry:', err);
        setError('Ein unerwarteter Fehler ist aufgetreten.');
      }
    });
  };

  if (!activeOrgId || !activeOrg) return null;

  const memberOptions = useMemo(
    () =>
      members.map((m) => ({
        value: m.user_id,
        label:
          m.first_name || m.last_name
            ? `${m.first_name || ''} ${m.last_name || ''}`.trim()
            : m.email,
        description: m.email
      })),
    [members]
  );

  const jobOpts = useMemo(
    () =>
      jobOptions.map((j) => ({
        value: j.id,
        label: j.title,
        description:
          [j.jobNumber, j.projectName].filter(Boolean).join(' · ') || undefined
      })),
    [jobOptions]
  );

  return (
    <>
      {otherOrgBanner && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-lg ${
            isBannerExiting ? 'animate-out' : 'animate-in'
          }`}
        >
          <div className="flex items-center gap-3 rounded-lg bg-red-50 p-4 text-red-800 shadow-lg ring-1 ring-red-200/50 dark:bg-red-950 dark:text-red-200 dark:ring-red-800/50">
            <AlertCircle className="size-5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold">{otherOrgBanner.title}</p>
              <p className="mt-0.5 text-sm">{otherOrgBanner.message}</p>
            </div>
            <button
              onClick={() => {
                setIsBannerExiting(true);
                setTimeout(() => {
                  setIsBannerExiting(false);
                  setOtherOrgBanner(null);
                }, 150);
              }}
              className="shrink-0 rounded-md p-1 hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
              aria-label="Banner schließen"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {!lockEntryMode && (
          <div className="space-y-2">
            <Label>Art des Eintrags</Label>
            <Select
              value={entryMode}
              onValueChange={(value) => setEntryMode(value as EntryMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">
                  Einstempeln & Ausstempeln
                </SelectItem>
                <SelectItem value="clock_in">Nur Einstempeln</SelectItem>
                <SelectItem value="clock_out">Nur Ausstempeln</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {isAdminOrManager && (
          <div className="space-y-2">
            <Label>Mitarbeiter</Label>
            <SearchableSelect
              options={memberOptions}
              value={selectedUserId}
              onChange={setSelectedUserId}
              placeholder={
                isLoadingMembers ? 'Lädt...' : 'Mitarbeiter auswählen'
              }
              searchPlaceholder="Mitarbeiter suchen..."
              emptyMessage="Kein Mitarbeiter gefunden"
              disabled={isLoadingMembers}
            />
          </div>
        )}

        {canAssignJob && (
          <div className="space-y-2">
            <Label>Auftrag (optional)</Label>
            <SearchableSelect
              options={jobOpts}
              value={selectedJobId}
              onChange={(v) => setSelectedJobId(v)}
              placeholder={
                isLoadingJobs ? 'Lädt...' : 'Kein Auftrag'
              }
              searchPlaceholder="Auftrag suchen..."
              emptyMessage="Kein Auftrag gefunden"
              disabled={isLoadingJobs}
              allowNone
              noneLabel="Kein Auftrag"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label>Datum</Label>
          <DatePicker
            value={selectedDate}
            onChange={setSelectedDate}
            placeholder="Datum wählen"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(entryMode === 'clock_in' || entryMode === 'both') && (
            <div className="space-y-2">
              <Label htmlFor="clockInTime">Einstempeln</Label>
              <div className="relative">
                <Clock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/80" />
                <TimeInput
                  id="clockInTime"
                  value={clockInTime}
                  onChange={setClockInTime}
                  className="pl-10 pr-3"
                />
              </div>
            </div>
          )}
          {(entryMode === 'clock_out' || entryMode === 'both') && (
            <div className="space-y-2">
              <Label htmlFor="clockOutTime">Ausstempeln</Label>
              <div className="relative">
                <Clock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/80" />
                <TimeInput
                  id="clockOutTime"
                  value={clockOutTime}
                  onChange={setClockOutTime}
                  className="pl-10 pr-3"
                />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
            {successMessage}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Speichern...
              </>
            ) : (
              'Speichern'
            )}
          </Button>
        </div>
      </form>
    </>
  );
}

function getErrorMessage(error: string): string {
  const messages: Record<string, string> = {
    not_authenticated: 'Du bist nicht angemeldet.',
    not_a_member: 'Du bist kein Mitglied dieser Organisation.',
    not_authorized: 'Du hast keine Berechtigung für diese Aktion.',
    target_not_a_member:
      'Der ausgewählte Mitarbeiter ist kein Mitglied dieser Organisation.',
    validation_failed: 'Die Validierung ist fehlgeschlagen.',
    insert_failed: 'Der Eintrag konnte nicht gespeichert werden.',
    unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.'
  };
  return messages[error] || error;
}
