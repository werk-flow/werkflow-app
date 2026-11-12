'use client';

import type { ReactElement, ReactNode } from 'react';
import { LogOut } from 'lucide-react';

import { useClockState } from '@/components/clock-state-provider';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { usePendingTask } from '@/hooks/use-server-action';
import {
  type CompletionGateKey,
  type FailingCompletionGate,
  type RunningClockOwner,
} from './work-lifecycle-completion-gates';

/** The singular sentence for one, the plural one with the count for more. */
function counted(count: number, one: string, many: (count: number) => string): string {
  return count === 1 ? one : many(count);
}

const INSTRUCTIONS_SECTION = '„Arbeitsanweisungen & Notizen“';

/** What each gate says and how to clear it, except the running clock, which depends on whose time runs. */
const GATE_COPY: Record<
  Exclude<CompletionGateKey, 'activeJobClocks'>,
  (count: number) => { sentence: string; hint?: string; link?: { href: string; label: string } }
> = {
  incompleteRequiredInstructions: (count) => ({
    sentence: counted(
      count,
      'Ein Pflichtpunkt der Arbeitsanweisungen ist offen.',
      (n) => `${n} Pflichtpunkte der Arbeitsanweisungen sind offen.`,
    ),
    hint: `Hake ${count === 1 ? 'ihn' : 'sie'} unter ${INSTRUCTIONS_SECTION} ab.`,
  }),
  reopenedInstructionPredecessors: (count) => ({
    sentence: counted(
      count,
      'Ein erledigter Punkt hängt an einem Vorgänger, der wieder offen ist.',
      (n) => `${n} erledigte Punkte hängen an Vorgängern, die wieder offen sind.`,
    ),
    hint: `Erledige ${count === 1 ? 'den Vorgänger' : 'die Vorgänger'} unter ${INSTRUCTIONS_SECTION}.`,
  }),
  incompleteInstructionEvidence: (count) => ({
    sentence: counted(count, 'Ein Pflichtnachweis fehlt.', (n) => `${n} Pflichtnachweise fehlen.`),
    hint: `Erfasse ${count === 1 ? 'ihn' : 'sie'} unter „Arbeitsnachweise“ und ordne ${count === 1 ? 'ihn' : 'sie'} unter „Nachweiserwartung erfüllen“ zu.`,
  }),
  openBlockers: (count) => ({
    sentence: counted(count, 'Ein Blocker ist offen.', (n) => `${n} Blocker sind offen.`),
    link: { href: '#offene-punkte', label: 'Blocker klären' },
  }),
  openCompletionDependencies: (count) => ({
    sentence: counted(
      count,
      'Eine Abschlussvoraussetzung ist offen.',
      (n) => `${n} Abschlussvoraussetzungen sind offen.`,
    ),
    link: { href: '#offene-punkte', label: 'Voraussetzungen ansehen' },
  }),
  incompleteProjectChildren: (count) => ({
    sentence: counted(
      count,
      'Ein Auftrag des Projekts ist nicht abgeschlossen.',
      (n) => `${n} Aufträge des Projekts sind nicht abgeschlossen.`,
    ),
    hint: `Schließe ${count === 1 ? 'ihn' : 'sie'} zuerst ab.`,
  }),
};

function runningClockSentence(owner: RunningClockOwner, count: number): string {
  if (owner === 'own') return 'Deine Zeit läuft noch auf diesem Auftrag.';
  if (owner === 'own-and-others') {
    return counted(
      count - 1,
      'Deine Zeit und eine weitere Zeiterfassung laufen noch auf diesem Auftrag.',
      (n) => `Deine Zeit und ${n} weitere Zeiterfassungen laufen noch auf diesem Auftrag.`,
    );
  }
  if (owner === 'others') {
    return counted(
      count,
      'Auf diesem Auftrag läuft noch die Zeit einer anderen Person.',
      (n) => `Auf diesem Auftrag laufen noch ${n} Zeiterfassungen anderer Personen.`,
    );
  }
  return counted(
    count,
    'Auf diesem Auftrag läuft noch eine Zeiterfassung.',
    (n) => `Auf diesem Auftrag laufen noch ${n} Zeiterfassungen.`,
  );
}

function GateRow({ sentence, children }: { sentence: string; children?: ReactNode }): ReactElement {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border px-3 py-2">
      <span className="font-medium">{sentence}</span>
      {children}
    </li>
  );
}

/**
 * The running-clock gate. The viewer's own time ends here; when it is the only
 * open point, the same click completes execution.
 */
function RunningClockGate({
  count,
  owner,
  endCompletes,
  isPrimary,
  completeExecution,
  refreshGates,
  onRefusal,
}: {
  count: number;
  owner: RunningClockOwner;
  endCompletes: boolean;
  isPrimary: boolean;
  completeExecution: () => Promise<string | null>;
  refreshGates: () => Promise<void>;
  onRefusal: (message: string | null) => void;
}): ReactElement {
  const { clockOut } = useClockState();
  const { showBanner } = useBanner();
  const { run, isPending } = usePendingTask();

  const endOwnTime = async (): Promise<void> => {
    onRefusal(null);
    const result = await clockOut();
    if (!result.success) {
      onRefusal(
        'Deine Zeit konnte nicht beendet werden. Prüfe sie unter „Meine Zeit“ und versuche es erneut.',
      );
      return;
    }
    if (result.kept) {
      // Without signal the end waits on the phone; the server still sees the time running, so nothing completes yet.
      showBanner({
        variant: 'info',
        message:
          'Deine Zeit ist auf dem Gerät beendet und wird gesendet, sobald du Netz hast. Schließe danach ab.',
      });
      return;
    }
    if (result.outcome === 'recovery_required') {
      showBanner({
        variant: 'info',
        message: 'Die Erfassung ist ungewöhnlich lang. Prüfe sie unter „Meine Zeit“, bevor du abschließt.',
      });
      return;
    }
    if (!endCompletes) {
      // The other open points stay; the clock gate leaves with this click, not with the next live event.
      await refreshGates();
      showBanner({ variant: 'success', message: 'Die Arbeitszeit wurde beendet.' });
      return;
    }
    onRefusal(await completeExecution());
  };

  return (
    <GateRow sentence={runningClockSentence(owner, count)}>
      {owner === 'own' || owner === 'own-and-others' ? (
        <Button
          type="button"
          size="sm"
          variant={isPrimary ? 'default' : 'outline'}
          className="min-h-11"
          data-testid={isPrimary ? 'field-primary-next-action' : undefined}
          pending={isPending}
          onClick={() => void run(endOwnTime)}
        >
          <LogOut className="size-4" />
          {endCompletes ? 'Zeit beenden und abschließen' : 'Zeit beenden'}
        </Button>
      ) : owner === 'others' ? (
        <span className="text-muted-foreground">
          {count === 1
            ? 'Abschließen geht, sobald sie beendet ist.'
            : 'Abschließen geht, sobald sie beendet sind.'}
        </span>
      ) : (
        <Button asChild size="sm" variant="link">
          <a href="#zeit">Meine Zeit prüfen</a>
        </Button>
      )}
    </GateRow>
  );
}

/**
 * Why „Ausführung abschließen“ waits: each failing gate in one sentence with
 * the step that clears it.
 */
export function WorkLifecycleCompletionGateList({
  id,
  gates,
  clockOwner,
  clockEndCompletes,
  clockEndIsPrimary,
  completeExecution,
  refreshGates,
  onRefusal,
}: {
  id: string;
  gates: FailingCompletionGate[];
  clockOwner: RunningClockOwner;
  /** Ending the viewer's own time clears the last gate, so the click also completes execution. */
  clockEndCompletes: boolean;
  clockEndIsPrimary: boolean;
  completeExecution: () => Promise<string | null>;
  /** Reads the card's snapshot again after the worker's own time ended. */
  refreshGates: () => Promise<void>;
  /** Shows why ending the time or completing failed, or clears it with null. */
  onRefusal: (message: string | null) => void;
}): ReactElement {
  return (
    <section id={id} aria-label="Vor dem Abschließen offen" className="space-y-2 text-sm">
      <p className="text-muted-foreground">Vor dem Abschließen ist noch offen:</p>
      <ul className="space-y-2">
        {gates.map((gate) => {
          if (gate.key === 'activeJobClocks') {
            return (
              <RunningClockGate
                key={gate.key}
                count={gate.count}
                owner={clockOwner}
                endCompletes={clockEndCompletes}
                isPrimary={clockEndIsPrimary}
                completeExecution={completeExecution}
                refreshGates={refreshGates}
                onRefusal={onRefusal}
              />
            );
          }
          const copy = GATE_COPY[gate.key](gate.count);
          return (
            <GateRow key={gate.key} sentence={copy.sentence}>
              {copy.hint && <span className="text-muted-foreground">{copy.hint}</span>}
              {copy.link && (
                <Button asChild size="sm" variant="link">
                  <a href={copy.link.href}>{copy.link.label}</a>
                </Button>
              )}
            </GateRow>
          );
        })}
      </ul>
    </section>
  );
}
