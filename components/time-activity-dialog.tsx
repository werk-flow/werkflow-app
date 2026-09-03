'use client';

import { useState } from 'react';
import {
  AlarmClock,
  BriefcaseBusiness,
  Coffee,
  Loader2,
  PhoneCall,
  Route,
  Users,
} from 'lucide-react';

import { JobPickerModal } from '@/components/job-picker-modal';
import { useClockState } from '@/components/clock-state-provider';
import { Button } from '@/components/ui/button';
import { useBanner } from '@/components/ui/banner';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useServerAction } from '@/hooks/use-server-action';
import { cn } from '@/lib/utils';
import { TIME_ACTIVITY_LABELS } from '@/lib/time-tracking/types';
import type {
  TimeActivitySelection,
  TimeInternalActivity,
  TimeSegmentKind,
  TimeStandbyContext,
  TimeTravelRole,
  TimeTravelRoute,
} from '@/lib/time-tracking/types';

const ACTIVITY_OPTIONS: Array<{
  kind: TimeSegmentKind;
  label: string;
  icon: typeof BriefcaseBusiness;
}> = [
  { kind: 'work', label: TIME_ACTIVITY_LABELS.work, icon: BriefcaseBusiness },
  { kind: 'travel', label: TIME_ACTIVITY_LABELS.travel, icon: Route },
  { kind: 'break', label: TIME_ACTIVITY_LABELS.break, icon: Coffee },
  { kind: 'standby', label: TIME_ACTIVITY_LABELS.standby, icon: AlarmClock },
  { kind: 'callout', label: TIME_ACTIVITY_LABELS.callout, icon: PhoneCall },
  { kind: 'internal_activity', label: TIME_ACTIVITY_LABELS.internal_activity, icon: Users },
];

function buildSelection(
  kind: TimeSegmentKind,
  jobId: string | null,
  internalType: TimeInternalActivity,
  travelRoute: TimeTravelRoute,
  travelRole: TimeTravelRole,
  standbyContext: TimeStandbyContext
): TimeActivitySelection {
  if (kind === 'break') {
    return { kind, allocationKind: 'none' };
  }
  if (kind === 'standby') {
    return { kind, allocationKind: 'none', standbyContext };
  }
  if (kind === 'internal_activity') {
    return { kind, allocationKind: 'internal_activity', internalType };
  }
  if (kind === 'travel') {
    return jobId
      ? { kind, allocationKind: 'job', jobId, travelRoute, travelRole }
      : {
          kind,
          allocationKind: 'unallocated',
          jobId: null,
          travelRoute,
          travelRole,
        };
  }
  return jobId
    ? { kind, allocationKind: 'job', jobId }
    : { kind, allocationKind: 'unallocated', jobId: null };
}

type TimeActivityDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  preferredJobId?: string | null;
  initialActivity?: TimeSegmentKind;
};

export function TimeActivityDialog(props: TimeActivityDialogProps) {
  return props.open ? <TimeActivityDialogForm {...props} /> : null;
}

function TimeActivityDialogForm({
  open,
  onOpenChange,
  organizationId,
  preferredJobId = null,
  initialActivity,
}: TimeActivityDialogProps) {
  const { state, isPending, transitionActivity, recoverAndContinue, clockOut } = useClockState();
  const { showBanner } = useBanner();
  const current = state?.currentActivity;
  const [kind, setKind] = useState<TimeSegmentKind>(initialActivity ?? current?.kind ?? 'work');
  const [jobId, setJobId] = useState<string | null>(current?.jobId ?? preferredJobId);
  const [internalType, setInternalType] = useState<TimeInternalActivity>(current?.internalType ?? 'internal_work');
  const [travelRoute, setTravelRoute] = useState<TimeTravelRoute>(current?.travelRoute ?? 'unspecified');
  const [travelRole, setTravelRole] = useState<TimeTravelRole>(current?.travelRole ?? 'unspecified');
  const [standbyContext, setStandbyContext] = useState<TimeStandbyContext>(current?.standbyContext ?? 'unspecified');
  const [showJobPicker, setShowJobPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each footer button spins for its own call; the shared clock `isPending`
  // only gates both against a double submit.
  const submitAction = useServerAction(submit);
  const endAction = useServerAction(endNow);

  const availableOptions = ACTIVITY_OPTIONS.filter((option) =>
    option.kind !== 'break' || (
      state?.isClockedIn && state.breakMode === 'manual'
    )
  );
  const canLinkJob = kind === 'work' || kind === 'travel' || kind === 'callout';
  const selectedJobLabel =
    jobId && state?.activeJobId === jobId && state.activeJobInfo
      ? state.activeJobInfo.title
      : jobId
        ? 'Auftrag ausgewählt'
        : 'Ohne Auftrag';
  const recovery = Boolean(state?.recoveryReason);

  async function submit(): Promise<void> {
    setError(null);
    const selection = buildSelection(kind, jobId, internalType, travelRoute, travelRole, standbyContext);
    const result = recovery
      ? await recoverAndContinue(selection)
      : await transitionActivity(selection);
    if (!result.success) {
      if (result.error === 'time_transition_working_other_org') {
        onOpenChange(false);
        showBanner({
          variant: 'error',
          message:
            'Bereits in anderer Organisation eingestempelt: Bitte beende dort zuerst die laufende Zeiterfassung.',
        });
        return;
      }
      if (result.error === 'on_approved_vacation') {
        onOpenChange(false);
        showBanner({
          variant: 'error',
          message:
            'Heute ist Urlaub genehmigt: Einstempeln ist deshalb nicht möglich. Falls du doch arbeitest, kann eine verantwortliche Person den Urlaub stornieren.',
        });
        return;
      }
      setError(result.error === 'time_transition_stale_version'
        ? 'Der Stand hat sich geändert. Bitte prüfe die aktuelle Erfassung und versuche es erneut.'
        : 'Die Aktivität konnte nicht gespeichert werden. Bitte versuche es erneut.');
      return;
    }
    if (result.outcome === 'recovery_required') {
      setError('Die Erfassung muss zuerst geprüft werden. Du kannst sie fortsetzen oder jetzt beenden.');
      return;
    }
    onOpenChange(false);
    if (result.notice === 'sickness_reported_today') {
      showBanner({
        variant: 'info',
        message:
          'Für heute liegt eine Krankmeldung vor: Du bist eingestempelt. Bitte prüfe deine Krankmeldung und trage das Enddatum nach, wenn du wieder arbeitest.',
        autoDismissMs: 8000,
      });
    }
  }

  async function endNow(): Promise<void> {
    setError(null);
    const result = await clockOut(recovery);
    if (!result.success) {
      setError('Die Erfassung konnte nicht beendet werden. Bitte versuche es erneut.');
      return;
    }
    if (result.outcome === 'recovery_required') {
      setError('Die Erfassung ist ungewöhnlich lang. Prüfe den Stand und bestätige das Beenden erneut.');
      return;
    }
    onOpenChange(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => {
        if (nextOpen) setError(null);
        onOpenChange(nextOpen);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{state?.isClockedIn ? 'Aktivität wechseln' : 'Zeiterfassung starten'}</DialogTitle>
            <DialogDescription>
              Wähle, was du gerade machst. Der Wechsel beendet die laufende Aktivität und startet die neue in einem Schritt.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {recovery && (
              <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-900 dark:text-yellow-100">
                <p className="font-medium">Ungewöhnlich lange Erfassung</p>
                <p className="mt-1">Prüfe den Stand. Du kannst bewusst fortsetzen oder die Erfassung jetzt beenden.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Aktivität wählen">
              {availableOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <Button
                    key={option.kind}
                    type="button"
                    variant={kind === option.kind ? 'secondary' : 'outline'}
                    className={cn('h-auto min-h-16 flex-col gap-1.5', kind === option.kind && 'border-primary/40 ring-2 ring-primary')}
                    aria-pressed={kind === option.kind}
                    onClick={() => setKind(option.kind)}
                  >
                    <Icon className="size-5" />
                    {option.label}
                  </Button>
                );
              })}
            </div>

            {canLinkJob && (
              <Field label="Zuordnung" htmlFor="time-activity-job">
                <div className="flex gap-2">
                  <Button
                    id="time-activity-job"
                    type="button"
                    variant="outline"
                    className="min-h-11 flex-1 justify-start"
                    aria-label={`Auftrag auswählen: ${selectedJobLabel}`}
                    onClick={() => setShowJobPicker(true)}
                  >
                    <BriefcaseBusiness className="size-4" />
                    <span className="truncate">{selectedJobLabel}</span>
                  </Button>
                  {jobId && <Button type="button" variant="ghost" onClick={() => setJobId(null)}>Lösen</Button>}
                </div>
              </Field>
            )}

            {kind === 'internal_activity' && (
              <Field label="Interne Tätigkeit" htmlFor="time-internal-type">
                <Select value={internalType} onValueChange={(value) => setInternalType(value as TimeInternalActivity)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal_work">Betriebsarbeit</SelectItem>
                    <SelectItem value="meeting">Besprechung</SelectItem>
                    <SelectItem value="training">Schulung</SelectItem>
                    <SelectItem value="other">Sonstiges</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}

            {kind === 'travel' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Strecke" htmlFor="time-travel-route">
                  <Select value={travelRoute} onValueChange={(value) => setTravelRoute(value as TimeTravelRoute)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="company_to_site">Betrieb → Einsatzort</SelectItem>
                      <SelectItem value="home_to_site">Zuhause → Einsatzort</SelectItem>
                      <SelectItem value="site_to_site">Einsatzort → Einsatzort</SelectItem>
                      <SelectItem value="site_to_company">Einsatzort → Betrieb</SelectItem>
                      <SelectItem value="other">Andere Strecke</SelectItem>
                      <SelectItem value="unspecified">Nicht angegeben</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Rolle" htmlFor="time-travel-role">
                  <Select value={travelRole} onValueChange={(value) => setTravelRole(value as TimeTravelRole)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="driver">Selbst gefahren</SelectItem>
                      <SelectItem value="passenger">Mitgefahren</SelectItem>
                      <SelectItem value="unspecified">Nicht angegeben</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}

            {kind === 'standby' && (
              <Field label="Bereitschaft" htmlFor="time-standby-context">
                <Select value={standbyContext} onValueChange={(value) => setStandbyContext(value as TimeStandbyContext)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on_site">Vor Ort</SelectItem>
                    <SelectItem value="remote">Extern</SelectItem>
                    <SelectItem value="unspecified">Nicht angegeben</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            {state?.isClockedIn && (
              <Button type="button" variant="outline" disabled={isPending} onClick={() => void endAction.run()}>
                {endAction.isPending && <Loader2 className="size-4 animate-spin" />}
                Erfassung beenden
              </Button>
            )}
            <Button type="button" disabled={isPending} onClick={() => void submitAction.run()}>
              {submitAction.isPending && <Loader2 className="size-4 animate-spin" />}
              {recovery ? 'Prüfen und fortsetzen' : state?.isClockedIn ? 'Aktivität wechseln' : 'Starten'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <JobPickerModal
        open={showJobPicker}
        onClose={() => setShowJobPicker(false)}
        onConfirm={(selectedJobId) => {
          setJobId(selectedJobId);
          setShowJobPicker(false);
        }}
        organizationId={organizationId}
        mode={state?.isClockedIn ? 'switch' : 'clock_in'}
        currentJobId={state?.activeJobId ?? null}
        isPending={isPending}
      />
    </>
  );
}
