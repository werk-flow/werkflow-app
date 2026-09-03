'use client';

import { useState, useEffect, useMemo } from 'react';
import { usePendingTask } from '@/hooks/use-server-action';
import { Loader2, Clock } from 'lucide-react';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { TimeInput } from '@/components/ui/time-input';
import { Field } from '@/components/ui/field';
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
import type {
  CalendarEntryDialogJobOption,
  CalendarEntryDialogMember,
} from '@/lib/jobs/types';
import { validateManualEntries } from '@/lib/time-tracking/validation';
import type {
  ManualEntryInput,
  TimeEntry
} from '@/lib/time-tracking/types';
import { useUserProfile } from '@/components/user/user-profile-context';
import { toLocalDateString } from '@/lib/utils';
import type { CalendarEntryDraft } from '@/components/kalender/calendar-entry-draft';

type EntryMode = 'clock_in' | 'clock_out' | 'both';

type OrgMember = CalendarEntryDialogMember;
type JobOption = CalendarEntryDialogJobOption;

export interface ManualEntryFormContentProps {
  onSuccess?: (entries: TimeEntry[]) => void | Promise<void>;
  preselectedUserId?: string;
  preselectedDate?: Date;
  preselectedClockInTime?: string;
  preselectedClockOutTime?: string;
  prefetchedMembers?: OrgMember[];
  prefetchedJobs?: JobOption[];
  lockEntryMode?: boolean;
  onDraftChange?: (draft: CalendarEntryDraft | null) => void;
  /** Whether the form is active/visible. Controls data-fetching effects. Defaults to true. */
  isActive?: boolean;
}

export function ManualEntryFormContent({
  onSuccess,
  preselectedUserId,
  preselectedDate,
  preselectedClockInTime,
  preselectedClockOutTime,
  prefetchedMembers,
  prefetchedJobs,
  lockEntryMode,
  onDraftChange,
  isActive = true,
}: ManualEntryFormContentProps) {
  const { activeOrgId, activeOrg } = useOrganization();
  const { profile } = useUserProfile();
  const { run: runPendingTask, isPending } = usePendingTask();

  const [entryMode, setEntryMode] = useState<EntryMode>('both');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    preselectedDate ?? new Date()
  );
  const [clockInTime, setClockInTime] = useState(preselectedClockInTime || '09:00');
  const [clockOutTime, setClockOutTime] = useState(preselectedClockOutTime || '17:00');
  const isAdmin = activeOrg?.role === 'admin';
  const isAdminOrManager =
    activeOrg?.role === 'admin' || activeOrg?.role === 'buero';
  const currentUserId = profile?.id || null;
  const [selectedUserId, setSelectedUserId] = useState(
    preselectedUserId || (isAdminOrManager ? '' : currentUserId || '')
  );

  const [members, setMembers] = useState<OrgMember[]>(prefetchedMembers ?? []);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [jobOptions, setJobOptions] = useState<JobOption[]>(prefetchedJobs ?? []);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const canAssignJob =
    entryMode === 'clock_in' || entryMode === 'both';

  const [error, setError] = useState<string | null>(null);
  // A failed option load leaves a select empty; the reason must be visible.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ member?: string; date?: string }>({});
  const { showBanner } = useBanner();

  useEffect(() => {
    if (!prefetchedMembers) return;
    setMembers(prefetchedMembers);
    setIsLoadingMembers(false);
  }, [prefetchedMembers]);

  useEffect(() => {
    if (!isActive || !isAdminOrManager || !activeOrgId || prefetchedMembers) return;
    const fetchMembers = async () => {
      setIsLoadingMembers(true);
      try {
        const result = await getOrgMembersAction(activeOrgId!);
        if (result.success) {
          setMembers(
            (result.members || []).map((member) => ({
              userId: member.user_id,
              firstName: member.first_name ?? '',
              lastName: member.last_name ?? '',
              email: member.email,
              role: member.role,
            }))
          );
        } else {
          setLoadError('Die Mitarbeiterliste konnte nicht geladen werden.');
        }
      } catch (err) {
        console.error('Error fetching members:', err);
        setLoadError('Die Mitarbeiterliste konnte nicht geladen werden.');
      } finally {
        setIsLoadingMembers(false);
      }
    };
    fetchMembers();
  }, [isActive, isAdminOrManager, activeOrgId, prefetchedMembers]);

  useEffect(() => {
    if (!prefetchedJobs) return;
    setJobOptions(prefetchedJobs);
    setIsLoadingJobs(false);
  }, [prefetchedJobs]);

  useEffect(() => {
    if (!isActive || !activeOrgId || prefetchedJobs) return;
    const fetchJobs = async () => {
      setIsLoadingJobs(true);
      try {
        const result = isAdminOrManager
          ? await getAllOrgJobs(activeOrgId!)
          : await getAssignedJobs(activeOrgId!);
        if (result.success) {
          setJobOptions(result.jobs);
        } else {
          setLoadError('Die Auftragsliste konnte nicht geladen werden.');
        }
      } catch (err) {
        console.error('Error fetching jobs:', err);
        setLoadError('Die Auftragsliste konnte nicht geladen werden.');
      } finally {
        setIsLoadingJobs(false);
      }
    };
    fetchJobs();
  }, [isActive, activeOrgId, isAdminOrManager, prefetchedJobs]);

  useEffect(() => {
    if (canAssignJob) return;
    setSelectedJobId('');
  }, [canAssignJob]);

  useEffect(() => {
    if (!isActive || !onDraftChange) return;

    const targetUserId = isAdminOrManager ? selectedUserId : currentUserId;
    const [clockInHours, clockInMinutes] = clockInTime.split(':').map(Number);
    const [clockOutHours, clockOutMinutes] = clockOutTime.split(':').map(Number);
    const startMinutes = clockInHours * 60 + clockInMinutes;
    const endMinutes = clockOutHours * 60 + clockOutMinutes;
    const durationMinutes = endMinutes - startMinutes;

    if (
      entryMode !== 'both' ||
      !selectedDate ||
      !targetUserId ||
      !Number.isFinite(durationMinutes) ||
      durationMinutes <= 0
    ) {
      onDraftChange(null);
      return;
    }

    onDraftChange({
      date: selectedDate,
      startTime: clockInTime,
      durationMinutes,
      userIds: [targetUserId]
    });
  }, [
    clockInTime,
    clockOutTime,
    currentUserId,
    entryMode,
    isActive,
    isAdminOrManager,
    onDraftChange,
    selectedDate,
    selectedUserId
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!activeOrgId) {
      setError('Keine Organisation ausgewählt.');
      return;
    }

    if (isAdminOrManager && !selectedUserId) {
      setFieldErrors({ member: 'Bitte wähle einen Mitarbeiter aus.' });
      document.getElementById('manual-entry-member')?.focus();
      return;
    }

    const targetUserId = isAdminOrManager ? selectedUserId : currentUserId;
    if (!targetUserId) {
      setError('Keine Benutzerinformation verfügbar.');
      return;
    }

    if (!selectedDate) {
      setFieldErrors({ date: 'Bitte ein gültiges Datum wählen.' });
      document.getElementById('manual-entry-date')?.focus();
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

    void runPendingTask(async () => {
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

        const validationResult = validateManualEntries(existingEntries, entries, {
          allowFutureTimestamps: isAdmin
        });
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
          showBanner({
            variant: 'success',
            message: isPendingResult
              ? 'Antrag wurde zur Genehmigung eingereicht.'
              : 'Eintrag erfolgreich erstellt!',
          });
          await onSuccess?.(result.entries);
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
              ? `Du bist aktuell in „${result.otherOrgName}“ eingestempelt. Bitte stemple dort zuerst aus, bevor du hier startest.`
              : `Der ausgewählte Mitarbeiter ist aktuell in „${result.otherOrgName}“ eingestempelt. Bitte zuerst dort ausstempeln, bevor hier eine offene Arbeitszeit gestartet wird.`;

            // One failure, one surface: the inline error carries the full
            // explanation (the earlier extra top banner double-reported it).
            setError(`${title}: ${message}`);
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

  const memberOptions = useMemo(
    () =>
      members.map((m) => ({
        value: m.userId,
        label:
          m.firstName || m.lastName
            ? `${m.firstName || ''} ${m.lastName || ''}`.trim()
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
  const isOwnBueroEntry =
    activeOrg?.role === 'buero' && selectedUserId === currentUserId;

  if (!activeOrgId || !activeOrg) return null;

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorText>{loadError}</ErrorText>
        {!lockEntryMode && (
          <Field label="Art des Eintrags">
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
          </Field>
        )}

        {isAdminOrManager && (
          <Field
            label="Mitarbeiter"
            htmlFor="manual-entry-member"
            required
            error={fieldErrors.member}
          >
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
          </Field>
        )}

        {canAssignJob && (
          <Field label="Auftrag (optional)">
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
          </Field>
        )}

        <Field
          label="Datum"
          htmlFor="manual-entry-date"
          required
          error={fieldErrors.date}
        >
          <DatePicker
            ariaLabel="Datum"
            value={selectedDate}
            onChange={setSelectedDate}
            placeholder="Datum wählen"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(entryMode === 'clock_in' || entryMode === 'both') && (
            <Field label="Einstempeln" htmlFor="clockInTime" required>
              <div className="relative">
                <Clock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/80" />
                <TimeInput
                  value={clockInTime}
                  onChange={setClockInTime}
                  className="pl-10 pr-3"
                />
              </div>
            </Field>
          )}
          {(entryMode === 'clock_out' || entryMode === 'both') && (
            <Field label="Ausstempeln" htmlFor="clockOutTime" required>
              <div className="relative">
                <Clock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/80" />
                <TimeInput
                  value={clockOutTime}
                  onChange={setClockOutTime}
                  className="pl-10 pr-3"
                />
              </div>
            </Field>
          )}
        </div>

        <ErrorText>{error}</ErrorText>

        {isOwnBueroEntry ? (
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Eigene Nachträge werden zur Freigabe eingereicht. Du kannst sie
            nicht selbst freigeben.
          </p>
        ) : null}

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
