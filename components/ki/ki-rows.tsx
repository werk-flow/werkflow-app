'use client';

import {
  Check,
  ChevronRight,
  CircleDashed,
  CircleCheck,
  ListTodo,
  MessageCircleQuestion,
  Pencil,
  TextSearch,
} from 'lucide-react';
import { memo, useState } from 'react';

import { AiInlineText, AiMarkdown } from '@/components/shared/ai-markdown';
import { Button } from '@/components/ui/button';
import { PlainButton } from '@/components/ui/plain-button';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { useClientRead } from '@/hooks/use-client-read';
import type { AiQuestionRow, AiTodoRow, AiToolOutcome, AiToolRow } from '@/lib/ai/thread-types';
import { readInBackground } from '@/lib/data/background-read-client';
import { lieferscheinCard } from '@/lib/ui/ki-lieferschein';
import { toolDetailLines } from '@/lib/ui/ki-rows';
import { KiLieferscheinCard } from './ki-lieferschein-card';
import { cn } from '@/lib/utils';

// The rows of the agent's work in a WerkFlow KI thread (werk-flow/werkflow-planning#533):
// tool calls, questions and to-do lists. Every text in them is model or record
// text and renders through the one safe renderer (B11).

/** A pencil for a draft, a magnifier over text for a read, a check for a confirmation. */
const CONTROL_ICONS = { read: TextSearch, draft: Pencil, confirm: Check } as const;

const OUTCOME_TEXT: Readonly<Record<Exclude<AiToolOutcome, 'ok'>, string>> = {
  refused: 'Nicht erlaubt',
  failed: 'Fehlgeschlagen',
  not_run: 'Nicht ausgeführt',
};

/** An opened tool row's input and result, read when it opens and never with the thread (brief non-negotiable 5). */
function KiToolDetail({
  organizationId,
  threadId,
  row,
}: {
  organizationId: string;
  threadId: string;
  row: AiToolRow;
}): React.JSX.Element {
  const read = useClientRead({
    read: (signal) => readInBackground('ki-tool-detail', { organizationId, threadId, key: row.key }, signal),
    deps: [organizationId, threadId, row.key, row.revision],
    failureMessage: 'Die Details konnten nicht geladen werden.',
  });
  if (read.failure) return <SectionError failure={read.failure} />;
  if (!read.data)
    return (
      <div className="space-y-2 py-1 pl-6" aria-hidden="true">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  const { detail } = read.data;
  const card = lieferscheinCard(detail.result);
  if (card)
    return (
      <div className="ml-2 border-l py-1 pl-4">
        <KiLieferscheinCard card={card} />
      </div>
    );
  const lines = toolDetailLines(detail);
  return (
    <div className="ml-2 space-y-2 border-l py-1 pl-4 text-muted-foreground">
      {lines.input.map((line) => (
        <p key={line}>
          <AiInlineText text={line} />
        </p>
      ))}
      {lines.entries.length > 0 && (
        <ul className="space-y-1">
          {lines.entries.map((entry, index) => (
            <li key={index}>
              <span className="flex flex-wrap gap-x-2">
                <AiInlineText text={entry.text} />
                {entry.href && (
                  <TextLink href={entry.href} prefetch={false}>
                    Öffnen
                  </TextLink>
                )}
              </span>
              {entry.details.map((detail, line) => (
                <span key={line} className="block pl-4 text-xs">
                  <AiInlineText text={detail} />
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {row.outcome === 'ok' && lines.entries.length === 0 && !detail.resultOmitted && <p>Nichts gefunden.</p>}
      {lines.total !== null && lines.total > lines.entries.length && <p>{lines.total} Treffer insgesamt</p>}
      {detail.resultOmitted && <p>Das Ergebnis ist zu groß, um es hier zu zeigen.</p>}
    </div>
  );
}

/** A tool call: collapsed to its label and state; opening it reads what the tool got and gave. */
export const KiToolRow = memo(function KiToolRow({
  row,
  running,
  organizationId,
  threadId,
}: {
  row: AiToolRow;
  running: boolean | 'stopped';
  organizationId: string;
  threadId: string;
}) {
  const [open, setOpen] = useState(false);
  const Icon = CONTROL_ICONS[row.control];
  const state =
    running === true
      ? 'läuft …'
      : running === 'stopped'
        ? 'Abgebrochen'
        : row.outcome && row.outcome !== 'ok'
          ? OUTCOME_TEXT[row.outcome]
          : null;
  const header = (
    <>
      <Icon className="text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <AiInlineText text={row.label} />
      </span>
      {state && (
        <span className={cn('text-xs text-muted-foreground', running === true && 'animate-live')}>
          {state}
        </span>
      )}
      {row.hasDetail && (
        <ChevronRight
          className={cn('text-muted-foreground transition-transform', open && 'rotate-90')}
          aria-hidden="true"
        />
      )}
    </>
  );
  const shape =
    'flex min-h-11 w-full items-center gap-2 rounded-md text-left sm:min-h-8 [&_svg]:size-4 [&_svg]:shrink-0';
  return (
    <li className="text-sm" aria-busy={running === true || undefined}>
      {row.hasDetail ? (
        <PlainButton aria-expanded={open} className={shape} onClick={() => setOpen((current) => !current)}>
          {header}
        </PlainButton>
      ) : (
        <div className={shape}>{header}</div>
      )}
      {open && <KiToolDetail organizationId={organizationId} threadId={threadId} row={row} />}
    </li>
  );
});

/**
 * A question of the agent with the answers it offers. Tapping one sends it as
 * the person's next message; once the thread has a message after it, the
 * question shows what was answered.
 */
export const KiQuestion = memo(function KiQuestion({
  row,
  answered,
  open,
  onAnswer,
}: {
  row: AiQuestionRow;
  /** The person's message after the question, or null. */
  answered: string | null;
  /** The thread's last question without an answer, while no turn runs. */
  open: boolean;
  onAnswer: (option: string) => void;
}) {
  return (
    <li className="space-y-3 rounded-lg border p-3">
      <div className="flex gap-2">
        <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <AiMarkdown text={row.question} />
      </div>
      <div role="group" aria-label="Antworten" className="flex flex-wrap gap-2">
        {row.options.map((option) => (
          <Button
            key={option}
            variant={answered === option ? 'default' : 'outline'}
            className="h-auto min-h-9 max-w-full whitespace-normal text-left"
            aria-pressed={answered === option}
            disabled={!open}
            onClick={() => onAnswer(option)}
          >
            <AiInlineText text={option} links={false} />
          </Button>
        ))}
      </div>
      {answered !== null && !row.options.includes(answered) && (
        <p className="text-sm text-muted-foreground">
          Deine Antwort: <AiInlineText text={answered} />
        </p>
      )}
    </li>
  );
});

/** The agent's plan for the turn; each later call replaces it, so ticked steps show at once. */
export const KiTodoList = memo(function KiTodoList({ row }: { row: AiTodoRow }) {
  return (
    <li className="space-y-1 text-sm">
      <p className="flex items-center gap-2 text-muted-foreground">
        <ListTodo className="size-4" aria-hidden="true" />
        Plan
      </p>
      <ul aria-label="Plan" className="space-y-1 pl-6">
        {row.steps.map((step, index) => (
          <li key={index} className="flex gap-2">
            {step.done ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden="true" />
            ) : (
              <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className={cn('min-w-0', step.done && 'text-muted-foreground line-through')}>
              <AiInlineText text={step.text} />
              <span className="sr-only">{step.done ? ', erledigt' : ', offen'}</span>
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
});
