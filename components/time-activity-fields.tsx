'use client';

import { type ReactElement } from 'react';
import { AlarmClock, BriefcaseBusiness, Coffee, PhoneCall, Route, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { TIME_ACTIVITY_LABELS } from '@/lib/time-tracking/types';
import type {
  TimeInternalActivity,
  TimeSegmentKind,
  TimeStandbyContext,
  TimeTravelRole,
  TimeTravelRoute,
} from '@/lib/time-tracking/types';

type TimeActivityOption = {
  kind: TimeSegmentKind;
  label: string;
  icon: typeof BriefcaseBusiness;
};

export const ACTIVITY_OPTIONS: TimeActivityOption[] = [
  { kind: 'work', label: TIME_ACTIVITY_LABELS.work, icon: BriefcaseBusiness },
  { kind: 'travel', label: TIME_ACTIVITY_LABELS.travel, icon: Route },
  { kind: 'break', label: TIME_ACTIVITY_LABELS.break, icon: Coffee },
  { kind: 'standby', label: TIME_ACTIVITY_LABELS.standby, icon: AlarmClock },
  { kind: 'callout', label: TIME_ACTIVITY_LABELS.callout, icon: PhoneCall },
  { kind: 'internal_activity', label: TIME_ACTIVITY_LABELS.internal_activity, icon: Users },
];

export function TimeActivityKindPicker({
  options,
  kind,
  onKindChange,
}: {
  options: TimeActivityOption[];
  kind: TimeSegmentKind;
  onKindChange: (kind: TimeSegmentKind) => void;
}): ReactElement {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Aktivität wählen">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <Button
            key={option.kind}
            type="button"
            variant="outline"
            // Selection is drawn inside the box (border + tint), never as an
            // outer ring: the scrolling body would clip it on the first row.
            className={cn(
              'h-auto min-h-16 flex-col gap-1.5 last:odd:col-span-2 sm:last:odd:col-span-1',
              kind === option.kind && 'border-primary bg-primary/10 hover:bg-primary/10',
            )}
            aria-pressed={kind === option.kind}
            onClick={() => onKindChange(option.kind)}
          >
            <Icon className="size-5" />
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

export function TimeActivityJobField({
  selectedJobLabel,
  hasJob,
  onPickJob,
  onClearJob,
}: {
  selectedJobLabel: string;
  hasJob: boolean;
  onPickJob: () => void;
  onClearJob: () => void;
}): ReactElement {
  return (
    <Field label="Zuordnung" htmlFor="time-activity-job">
      <div className="flex gap-2">
        <Button
          id="time-activity-job"
          type="button"
          variant="outline"
          className="min-h-11 min-w-0 flex-1 shrink justify-start"
          aria-label={`Auftrag auswählen: ${selectedJobLabel}`}
          onClick={onPickJob}
        >
          <BriefcaseBusiness className="size-4" />
          <span className="truncate">{selectedJobLabel}</span>
        </Button>
        {hasJob && (
          <Button type="button" variant="ghost" onClick={onClearJob}>
            Lösen
          </Button>
        )}
      </div>
    </Field>
  );
}

export function TimeActivityQualifierFields({
  kind,
  internalType,
  onInternalTypeChange,
  travelRoute,
  onTravelRouteChange,
  travelRole,
  onTravelRoleChange,
  standbyContext,
  onStandbyContextChange,
}: {
  kind: TimeSegmentKind;
  internalType: TimeInternalActivity;
  onInternalTypeChange: (internalType: TimeInternalActivity) => void;
  travelRoute: TimeTravelRoute;
  onTravelRouteChange: (travelRoute: TimeTravelRoute) => void;
  travelRole: TimeTravelRole;
  onTravelRoleChange: (travelRole: TimeTravelRole) => void;
  standbyContext: TimeStandbyContext;
  onStandbyContextChange: (standbyContext: TimeStandbyContext) => void;
}): ReactElement {
  return (
    <>
      {kind === 'internal_activity' && (
        <Field label="Interne Tätigkeit" htmlFor="time-internal-type">
          <Select
            value={internalType}
            onValueChange={(value) => onInternalTypeChange(value as TimeInternalActivity)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
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
            <Select
              value={travelRoute}
              onValueChange={(value) => onTravelRouteChange(value as TimeTravelRoute)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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
            <Select value={travelRole} onValueChange={(value) => onTravelRoleChange(value as TimeTravelRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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
          <Select
            value={standbyContext}
            onValueChange={(value) => onStandbyContextChange(value as TimeStandbyContext)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="on_site">Vor Ort</SelectItem>
              <SelectItem value="remote">Extern</SelectItem>
              <SelectItem value="unspecified">Nicht angegeben</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}
    </>
  );
}

export function TimeActivityRecoveryNotice(): ReactElement {
  return (
    <div className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground">
      <p className="font-medium">Ungewöhnlich lange Erfassung</p>
      <p className="mt-1">Prüfe den Stand. Du kannst bewusst fortsetzen oder die Erfassung jetzt beenden.</p>
    </div>
  );
}

export function TimeActivityStatusNotice({
  isReady,
  statusError,
  onRetry,
}: {
  isReady: boolean;
  statusError: string | null;
  onRetry: () => void;
}): ReactElement {
  return (
    <>
      {!isReady && (
        <p role="status" className="text-sm text-muted-foreground">
          {statusError ? 'Der Zeitstatus konnte nicht sicher geladen werden.' : 'Zeitstatus wird geladen…'}
        </p>
      )}
      {statusError && (
        <Button type="button" variant="outline" onClick={onRetry}>
          Erneut laden
        </Button>
      )}
    </>
  );
}
