'use client';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
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
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { PersonnelLifecycleView } from '@/lib/personnel/lifecycle-actions';
import { openWorkCounts, visitsFrom, type OpenWorkJob } from '@/lib/personnel/open-work';
import { formatGermanDate, toLocalDateString } from '@/lib/utils';

import type { PersonnelLifecycleHandover } from './use-personnel-lifecycle-handover';
import type { PersonnelLifecycleController } from './use-personnel-lifecycle-view';

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** „32 offene Aufträge, davon 2 im Parkplatz“: the count the member page's job list splits the same way. */
function openWorkSummary(openWork: readonly OpenWorkJob[]): string {
  const { total, parked } = openWorkCounts(openWork);
  const jobs = plural(total, 'offener Auftrag', 'offene Aufträge');
  return parked > 0 ? `${jobs}, davon ${parked} im Parkplatz` : jobs;
}

type OpenWorkCardProps = {
  data: PersonnelLifecycleView;
  canManage: boolean;
  disabled: boolean;
  onHandover: () => void;
};

/** The person's open work and unreplaced responsibilities, with the way to hand the work over. */
export function PersonnelLifecycleOpenWork({ data, canManage, disabled, onHandover }: OpenWorkCardProps) {
  const { openWork, strandedResponsibilities } = data.transitionInventory;
  if (openWork.length === 0 && strandedResponsibilities.length === 0) return null;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium">Offene Arbeit</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {[
            openWork.length > 0 ? `${openWorkSummary(openWork)}.` : null,
            strandedResponsibilities.length > 0
              ? `${plural(strandedResponsibilities.length, 'Verantwortung', 'Verantwortungen')} ohne Vertretung.`
              : null,
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
      </div>
      {canManage && openWork.length > 0 ? (
        <Button size="sm" variant="outline" disabled={disabled} onClick={onHandover}>
          Arbeit übergeben
        </Button>
      ) : null}
    </div>
  );
}

/**
 * What a transition that takes the person away leaves open, in the
 * transition's dialog: the open jobs and the planners' task they become.
 */
export function PersonnelLifecycleOpenWorkNote({
  openWork,
  onHandover,
}: {
  openWork: readonly OpenWorkJob[];
  onHandover: () => void;
}) {
  if (openWork.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
      <p className="font-medium">{openWorkSummary(openWork)}</p>
      <p className="text-xs text-muted-foreground">
        Was du nicht übergibst, bleibt zugewiesen. Einsätze nach dem Austrittsdatum erscheinen in den Aufgaben
        als „Einsatz umplanen“.
      </p>
      <Button type="button" size="sm" variant="outline" onClick={onHandover}>
        Arbeit übergeben
      </Button>
    </div>
  );
}

/** Where the job stands from the handover date: the visits that move, and those that stay. */
function jobSituation(job: OpenWorkJob, handoverFrom: string | null): string {
  if (job.parked) return 'Im Parkplatz';
  if (job.visits.length === 0) return 'Ohne Termin';
  const moving = handoverFrom ? visitsFrom(job, handoverFrom) : job.visits;
  const staying = job.visits.length - moving.length;
  const next = moving[0];
  const parts = [
    next
      ? `${plural(moving.length, 'Einsatz', 'Einsätze')}, nächster am ${formatGermanDate(next.date)}${next.time ? `, ${next.time} Uhr` : ''}`
      : `Kein Einsatz ab dem ${formatGermanDate(handoverFrom ?? '')}`,
  ];
  if (staying > 0 && handoverFrom) {
    parts.push(`${plural(staying, 'Einsatz', 'Einsätze')} davor bleiben`);
  }
  return parts.join(' · ');
}

type HandoverDialogProps = {
  lifecycle: PersonnelLifecycleController;
  handover: PersonnelLifecycleHandover;
};

/** The pickers' choices: never the leaver; work without a visit stays on a team, which needs a login. */
function handoverChoices(lifecycle: PersonnelLifecycleController, handover: PersonnelLifecycleHandover) {
  const { data } = lifecycle;
  const { handoverFrom, people } = handover;
  const handoverDate = handoverFrom ? toLocalDateString(handoverFrom) : null;
  const choices = people.select.options.filter((option) => option.value !== data.employeeRecordId);
  return {
    handoverDate,
    choices,
    loginChoices: choices.filter((option) => option.userId !== null),
    needsLogin: (job: OpenWorkJob): boolean => !handoverDate || visitsFrom(job, handoverDate).length === 0,
    pickerProps: { ...people.select, searchPlaceholder: 'Person suchen …', placeholder: 'Offen lassen' },
  };
}

/** The handover date and the one person who takes every job. */
function HandoverDefaults({ lifecycle, handover }: HandoverDialogProps) {
  const { data, isPending, fieldErrors } = lifecycle;
  const { handoverFrom, setHandoverFrom, targets, setAllTargets } = handover;
  const { choices, loginChoices, needsLogin, pickerProps } = handoverChoices(lifecycle, handover);
  const openWork = data.transitionInventory.openWork;
  const chosen = new Set(openWork.map((job) => targets[job.jobId] ?? ''));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Übergabe ab" htmlFor="handover-from" required error={fieldErrors['handover-from']}>
        <DatePicker value={handoverFrom} onChange={setHandoverFrom} disabled={isPending} />
      </Field>
      <Field label="Alle an …" htmlFor="handover-all" error={fieldErrors['handover-all']}>
        <SearchableSelect
          {...pickerProps}
          id="handover-all"
          placeholder="Person wählen"
          options={choices}
          value={chosen.size === 1 ? [...chosen].join('') : ''}
          onChange={(targetId) => {
            const takesTeamOnlyWork = loginChoices.some((choice) => choice.value === targetId);
            setAllTargets(
              targetId,
              openWork.flatMap((job) => (takesTeamOnlyWork || !needsLogin(job) ? [job.jobId] : [])),
            );
          }}
          disabled={isPending}
        />
      </Field>
    </div>
  );
}

/** One row per open job: where it stands from the handover date, and who takes it. */
function HandoverJobList({ lifecycle, handover }: HandoverDialogProps) {
  const { data, isPending } = lifecycle;
  const { targets, setTarget } = handover;
  const { handoverDate, choices, loginChoices, needsLogin, pickerProps } = handoverChoices(
    lifecycle,
    handover,
  );
  return (
    <ul className="divide-y rounded-md border" aria-label="Offene Aufträge">
      {data.transitionInventory.openWork.map((job) => (
        <li key={job.jobId} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{job.label}</p>
            <p className="text-xs text-muted-foreground">{jobSituation(job, handoverDate)}</p>
          </div>
          <SearchableSelect
            {...pickerProps}
            ariaLabel={`Wer übernimmt ${job.label}`}
            options={needsLogin(job) ? loginChoices : choices}
            allowNone
            noneLabel="Offen lassen"
            value={targets[job.jobId] ?? ''}
            onChange={(targetId) => setTarget(job.jobId, targetId)}
            disabled={isPending}
          />
        </li>
      ))}
    </ul>
  );
}

export function PersonnelLifecycleHandoverDialog({ lifecycle, handover }: HandoverDialogProps) {
  const { isPending, error } = lifecycle;
  const { open, setOpen } = handover;

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen} pending={isPending}>
        <DialogContent size="xl">
          <form
            className="contents"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void handover.submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>Offene Arbeit übergeben</DialogTitle>
              <DialogDescription>
                Wähle pro Auftrag, wer übernimmt. Die Person kommt ins Auftragsteam und übernimmt die Einsätze
                ab dem Übergabedatum.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-4 py-1">
              <HandoverDefaults lifecycle={lifecycle} handover={handover} />
              <HandoverJobList lifecycle={lifecycle} handover={handover} />
              <p className="text-xs text-muted-foreground">
                Aufträge ohne Auswahl bleiben, wie sie sind. Einsätze nach dem Austrittsdatum erscheinen dann
                in den Aufgaben als „Einsatz umplanen“.
              </p>
              <ErrorText>{error}</ErrorText>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                Abbrechen
              </Button>
              <Button type="submit" pending={isPending} disabled={isPending}>
                Übergeben
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {handover.warningDialog}
    </>
  );
}
