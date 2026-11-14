'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { UserRoundCheck } from 'lucide-react';

import { SectionTitle } from '@/components/shared/section-title';
import { RegionLoadError } from '@/components/shared/region-load-error';
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
import type { OrgMemberOption } from '@/components/auftraege/shared/employee-multi-select';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { useServerAction } from '@/hooks/use-server-action';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { describeFailure } from '@/lib/action-messages';
import { endWorkLead, nameWorkLead } from '@/lib/projects/work-lead-actions';
import {
  WORK_LEAD_ERROR_MESSAGES,
  type WorkLeadHolding,
  type WorkLeadPanel,
  type WorkLeadTarget,
} from '@/lib/projects/work-lead-types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { formatGermanDate } from '@/lib/utils';

const LEAD_FIELD_ID = 'work-lead-person';
const SAVE_FAILED = 'Die Projektleitung wurde nicht gespeichert. Versuche es erneut.';

type WorkLeadSectionProps = WorkLeadTarget & {
  /** Null when the read failed: the section shows the failure with a retry. */
  panel: WorkLeadPanel | null;
  members: OrgMemberOption[];
};

/**
 * „Projektleitung“ on a project or standalone job, for Admin and Büro: who
 * leads it, naming, changing and ending it, and every holding as history.
 * A write lands through the route render the action revalidates; other
 * sessions refresh on a change of `work_leads`.
 */
export function WorkLeadSection({
  targetType,
  targetId,
  panel,
  members,
}: WorkLeadSectionProps): ReactElement {
  useRealtimeRouterRefresh({ tables: ['work_leads'] });
  const [dialogOpen, setDialogOpen] = useState(false);
  const target = { targetType, targetId };
  return (
    <section
      aria-labelledby="work-lead-title"
      className="space-y-3 rounded-lg border bg-card p-4 sm:p-5"
      data-testid="work-lead-section"
    >
      <SectionTitle id="work-lead-title" icon={<UserRoundCheck className="size-4" />}>
        Projektleitung
      </SectionTitle>
      {panel ? (
        <WorkLeadSummary panel={panel} targetType={targetType} onOpen={() => setDialogOpen(true)} />
      ) : (
        <RegionLoadError title="Projektleitung nicht geladen">
          Die Projektleitung konnte gerade nicht geladen werden.
        </RegionLoadError>
      )}
      {panel && dialogOpen && (
        <WorkLeadDialog
          target={target}
          panel={panel}
          members={members}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </section>
  );
}

function WorkLeadSummary({
  panel,
  targetType,
  onOpen,
}: {
  panel: WorkLeadPanel;
  targetType: WorkLeadTarget['targetType'];
  onOpen: () => void;
}) {
  const { current, history } = panel;
  return (
    <div className="space-y-3">
      {current ? (
        <div>
          <p className="text-sm font-medium">{current.name}</p>
          <p className="text-xs text-muted-foreground">seit {formatGermanDate(current.startedAt)}</p>
        </div>
      ) : (
        <EmptyState
          size="compact"
          title="Noch keine Projektleitung."
          description={
            targetType === 'project'
              ? 'Sie sieht alle Aufträge des Projekts und prüft ihre Regie- und Änderungsnachweise.'
              : 'Sie prüft die Regie- und Änderungsnachweise dieses Auftrags.'
          }
        />
      )}
      <Button type="button" variant="outline" size="sm" onClick={onOpen}>
        {current ? 'Ändern oder beenden' : 'Projektleitung benennen'}
      </Button>
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

/**
 * The dialog's two writes. Each names the holding the dialog opened with, so
 * a write that crosses another person's change is refused.
 */
function useWorkLeadWrites(target: WorkLeadTarget, panel: WorkLeadPanel, onClose: () => void) {
  const { showBanner } = useBanner();
  const [current] = useState(panel.current);
  const [error, setError] = useState<string | null>(null);
  const waitForPanel = useSettleOnChange(panel);
  const settle = (result: { success: boolean }) => (result.success ? waitForPanel() : Promise.resolve());
  const naming = useServerAction(nameWorkLead, { settle });
  const ending = useServerAction(endWorkLead, { settle });
  const finish = (result: Awaited<ReturnType<typeof nameWorkLead>>, message: string) => {
    if (!result.success) {
      setError(describeFailure(result.error, WORK_LEAD_ERROR_MESSAGES, SAVE_FAILED));
      return;
    }
    onClose();
    showBanner({ variant: 'success', message });
  };
  return {
    current,
    error,
    namePending: naming.isPending,
    endPending: ending.isPending,
    name: (userId: string) =>
      void naming
        .run({ ...target, userId, expectedLeadId: current?.id ?? null })
        .then((result) => finish(result, 'Projektleitung gespeichert.')),
    end: (leadId: string) => {
      setError(null);
      void ending
        .run({ ...target, expectedLeadId: leadId })
        .then((result) => finish(result, 'Projektleitung beendet.'));
    },
  };
}

/** Names, changes or ends the lead. */
function WorkLeadDialog({
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
  const writes = useWorkLeadWrites(target, panel, onClose);
  const { current } = writes;
  const [userId, setUserId] = useState(current?.userId ?? '');
  const [attempted, setAttempted] = useState(false);
  const isPending = writes.namePending || writes.endPending;
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
    writes.name(userId);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={isPending}>
      <DialogContent>
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>{current ? 'Projektleitung ändern' : 'Projektleitung benennen'}</DialogTitle>
            <DialogDescription>
              Die Projektleitung sieht Umfang, Anweisungen und Nachweise und prüft die Regie- und
              Änderungsnachweise. Preise, Kosten und Kundendaten sieht sie nicht.
              {current &&
                ' Beendest du sie, bleiben offene Prüfungen bei den Zuständigen für Arbeitsnachweise.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2 py-1">
            <Field
              label="Person"
              htmlFor={LEAD_FIELD_ID}
              required
              error={attempted ? personError : undefined}
            >
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
            <ErrorText>{writes.error}</ErrorText>
          </DialogBody>
          <WorkLeadDialogFooter current={current} writes={writes} isPending={isPending} onClose={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WorkLeadDialogFooter({
  current,
  writes,
  isPending,
  onClose,
}: {
  current: WorkLeadHolding | null;
  writes: ReturnType<typeof useWorkLeadWrites>;
  isPending: boolean;
  onClose: () => void;
}) {
  return (
    <DialogFooter>
      {current && (
        <Button
          type="button"
          variant="destructive"
          className="sm:mr-auto"
          pending={writes.endPending}
          disabled={isPending}
          onClick={() => writes.end(current.id)}
        >
          Projektleitung beenden
        </Button>
      )}
      <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
        Abbrechen
      </Button>
      <Button pending={writes.namePending} type="submit">
        Speichern
      </Button>
    </DialogFooter>
  );
}
