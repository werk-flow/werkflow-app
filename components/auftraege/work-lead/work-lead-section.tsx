'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { UserRoundCheck } from 'lucide-react';

import { SectionTitle } from '@/components/shared/section-title';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useBanner } from '@/components/ui/banner';
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
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { FormDisclosure } from '@/components/ui/form-disclosure';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SectionError } from '@/components/ui/section-error';
import type { OrgMemberOption } from '@/components/auftraege/shared/employee-multi-select';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { useServerAction } from '@/hooks/use-server-action';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { endWorkLead, nameWorkLead } from '@/lib/projects/work-lead-actions';
import {
  WORK_LEAD_ERROR_MESSAGES,
  type WorkLeadHolding,
  type WorkLeadPanel,
  type WorkLeadTarget,
} from '@/lib/projects/work-lead-types';
import { describeFailure } from '@/lib/action-messages';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { formatGermanDate } from '@/lib/utils';

const LEAD_FIELD_ID = 'work-lead-person';
const SAVE_FAILED = 'Die Projektleitung wurde nicht gespeichert. Versuche es erneut.';

type WorkLeadSectionProps = WorkLeadTarget & {
  /** Null when the read failed: the section shows the failure with a retry. */
  panel: WorkLeadPanel | null;
  members: OrgMemberOption[];
  onRetry: () => void;
};

/**
 * „Projektleitung“ on a project or job, for Admin and Büro: who leads it, a
 * job's lead inherited from its project, naming, changing and ending it, and
 * every holding as history. Every write lands through the route render the
 * action revalidates; other sessions refresh on a change of `work_leads`.
 */
export function WorkLeadSection({
  targetType,
  targetId,
  panel,
  members,
  onRetry,
}: WorkLeadSectionProps): ReactElement {
  useRealtimeRouterRefresh({ tables: ['work_leads'] });
  const [dialog, setDialog] = useState<'name' | 'end' | null>(null);
  const target = { targetType, targetId };
  return (
    <section aria-labelledby="work-lead-title" className="space-y-3" data-testid="work-lead-section">
      <SectionTitle id="work-lead-title" icon={<UserRoundCheck className="size-4" />}>
        Projektleitung
      </SectionTitle>
      {panel ? (
        <WorkLeadSummary panel={panel} targetType={targetType} onName={() => setDialog('name')} onEnd={() => setDialog('end')} />
      ) : (
        <SectionError title="Projektleitung nicht geladen" onRetry={onRetry}>
          Die Projektleitung konnte gerade nicht geladen werden.
        </SectionError>
      )}
      {panel && dialog === 'name' && (
        <NameWorkLeadDialog
          target={target}
          panel={panel}
          members={members}
          onClose={() => setDialog(null)}
        />
      )}
      {panel?.current && dialog === 'end' && (
        <EndWorkLeadDialog target={target} current={panel.current} onClose={() => setDialog(null)} />
      )}
    </section>
  );
}

function WorkLeadSummary({
  panel,
  targetType,
  onName,
  onEnd,
}: {
  panel: WorkLeadPanel;
  targetType: WorkLeadTarget['targetType'];
  onName: () => void;
  onEnd: () => void;
}) {
  const { current, inherited, history } = panel;
  return (
    <div className="space-y-3">
      {current ? (
        <div>
          <p className="text-sm font-medium">{current.name}</p>
          <p className="text-xs text-muted-foreground">seit {formatGermanDate(current.startedAt)}</p>
        </div>
      ) : inherited ? (
        <div>
          <p className="text-sm font-medium">{inherited.name}</p>
          <p className="text-xs text-muted-foreground">vom Projekt übernommen</p>
        </div>
      ) : (
        <EmptyState
          size="compact"
          title="Noch keine Projektleitung"
          description={
            targetType === 'project'
              ? 'Die Projektleitung prüft die Regie- und Änderungsnachweise des Projekts und seiner Aufträge.'
              : 'Die Projektleitung prüft die Regie- und Änderungsnachweise dieses Auftrags.'
          }
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onName}>
          {current ? 'Ändern' : inherited ? 'Eigene Projektleitung benennen' : 'Projektleitung benennen'}
        </Button>
        {current && (
          <Button type="button" variant="ghost" size="sm" onClick={onEnd}>
            Beenden
          </Button>
        )}
      </div>
      {history.length > 0 && (
        <FormDisclosure label="Verlauf">
          <ul className="space-y-2 text-sm" aria-label="Verlauf der Projektleitung">
            {history.map((holding) => (
              <WorkLeadHistoryRow key={holding.id} holding={holding} />
            ))}
          </ul>
        </FormDisclosure>
      )}
    </div>
  );
}

function WorkLeadHistoryRow({ holding }: { holding: WorkLeadHolding }) {
  const started = `ab ${formatGermanDate(holding.startedAt)}${holding.startedByName ? `, benannt von ${holding.startedByName}` : ''}`;
  const ended = holding.endedAt
    ? `bis ${formatGermanDate(holding.endedAt)}${holding.endedByName ? `, beendet von ${holding.endedByName}` : ''}`
    : 'läuft';
  return (
    <li>
      <p className="font-medium">{holding.name}</p>
      <p className="text-xs text-muted-foreground">
        {started} · {ended}
      </p>
    </li>
  );
}

function NameWorkLeadDialog({
  target,
  panel,
  members,
  onClose,
}: {
  target: WorkLeadTarget;
  panel: WorkLeadPanel;
  members: OrgMemberOption[];
  onClose: () => void;
}) {
  const { showBanner } = useBanner();
  const [userId, setUserId] = useState(panel.current?.userId ?? '');
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waitForPanel = useSettleOnChange(panel);
  const { run, isPending } = useServerAction(nameWorkLead, {
    settle: (result) => (result.success ? waitForPanel() : Promise.resolve()),
  });
  const personError = userId ? undefined : 'Wähle eine Person.';
  const options = members.map((member) => ({
    value: member.userId,
    label: [member.firstName, member.lastName].filter(Boolean).join(' ') || 'Unbekannte Person',
  }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setAttempted(true);
    if (focusFirstInvalidField({ [LEAD_FIELD_ID]: personError })) return;
    void run({ ...target, userId }).then((result) => {
      if (!result.success) {
        setError(describeFailure(result.error, WORK_LEAD_ERROR_MESSAGES, SAVE_FAILED));
        return;
      }
      onClose();
      showBanner({ variant: 'success', message: 'Projektleitung gespeichert.' });
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={isPending}>
      <DialogContent>
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>{panel.current ? 'Projektleitung ändern' : 'Projektleitung benennen'}</DialogTitle>
            <DialogDescription>
              Die Projektleitung sieht den Umfang, die Anweisungen und die Nachweise und prüft die Regie- und
              Änderungsnachweise. Preise, Kosten und Kundendaten sieht sie nicht.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2 py-1">
            <Field label="Person" htmlFor={LEAD_FIELD_ID} required error={attempted ? personError : undefined}>
              <SearchableSelect
                id={LEAD_FIELD_ID}
                options={options}
                value={userId}
                onChange={setUserId}
                placeholder="Person wählen"
                searchPlaceholder="Person suchen …"
                disabled={isPending}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Abbrechen
            </Button>
            <Button pending={isPending} type="submit" disabled={isPending}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EndWorkLeadDialog({
  target,
  current,
  onClose,
}: {
  target: WorkLeadTarget;
  current: WorkLeadHolding;
  onClose: () => void;
}) {
  const { showBanner } = useBanner();
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useServerAction(endWorkLead);
  return (
    <AlertDialog open pending={isPending} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Projektleitung von {current.name} beenden?</AlertDialogTitle>
          <AlertDialogDescription>
            {current.name} prüft ab sofort keine Nachweise dieser Arbeit mehr; offene Prüfungen bleiben bei den Zuständigen für Arbeitsnachweise.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter error={error}>
          <AlertDialogCancel disabled={isPending}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            pending={isPending}
            onClick={(event) => {
              event.preventDefault();
              void run(target).then((result) => {
                if (!result.success) {
                  setError(describeFailure(result.error, WORK_LEAD_ERROR_MESSAGES, SAVE_FAILED));
                  return;
                }
                onClose();
                showBanner({ variant: 'success', message: 'Projektleitung beendet.' });
              });
            }}
          >
            Beenden
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
