'use client';

import { memo } from 'react';

import { AiMarkdown } from '@/components/shared/ai-markdown';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import type { AiChatMessage, AiThreadRow } from '@/lib/ai/thread-types';
import { questionAnswer, rowRunning, timelineOrder } from '@/lib/ui/ki-rows';
import { unconfirmedMarker } from '@/lib/ui/unconfirmed';
import { KiQuestion, KiTodoList, KiToolRow } from './ki-rows';

/** A message in the timeline; `unconfirmed` until the server saved it. */
export type TimelineMessage = AiChatMessage & { unconfirmed?: boolean };

/** An entry of the timeline: a message, or a row of the agent's work. */
export type TimelineEntry = TimelineMessage | AiThreadRow;

const isMessage = (entry: TimelineEntry): entry is TimelineMessage =>
  entry.role === 'user' || entry.role === 'assistant';

/**
 * One message. Memo keeps a finished message from rendering again while
 * another one streams; inside a streaming answer only its last block renders
 * (AiMarkdown, brief non-negotiable 3).
 */
const KiMessage = memo(function KiMessage({ message }: { message: TimelineMessage }) {
  if (message.role === 'user')
    return (
      <li className="flex justify-end" {...unconfirmedMarker(message.unconfirmed)}>
        <p className="max-w-2xl rounded-lg bg-muted px-3 py-2 whitespace-pre-wrap break-words">
          {message.text}
        </p>
      </li>
    );
  const writing = message.status === 'streaming';
  return (
    <li className="space-y-2" aria-busy={writing || undefined}>
      {message.text ? <AiMarkdown text={message.text} /> : null}
      {writing && (
        <p className="animate-live text-sm text-muted-foreground" role="status">
          schreibt …
        </p>
      )}
      {message.failure && <ErrorText>{message.failure}</ErrorText>}
    </li>
  );
});

/** A row of the agent's work, with what it derives from the rest of the thread. */
function KiRow({
  row,
  entries,
  thread,
}: {
  row: AiThreadRow;
  entries: readonly TimelineEntry[];
  thread: { organizationId: string; threadId: string; running: boolean; onAnswer: (text: string) => void };
}): React.JSX.Element {
  if (row.role === 'todo') return <KiTodoList row={row} />;
  if (row.role === 'question') {
    const state = questionAnswer(entries, row);
    return (
      <KiQuestion
        row={row}
        answered={typeof state === 'object' ? state.answered : null}
        open={state === 'open' && !thread.running}
        onAnswer={thread.onAnswer}
      />
    );
  }
  return (
    <KiToolRow
      row={row}
      running={rowRunning(entries, row)}
      organizationId={thread.organizationId}
      threadId={thread.threadId}
    />
  );
}

export function KiTimeline({
  messages,
  thread,
  unconfirmed,
  hasOlder,
  loadingOlder,
  onLoadOlder,
}: {
  messages: readonly TimelineEntry[];
  /** The thread the timeline shows; `running` while a turn of this page runs in it. */
  thread: { organizationId: string; threadId: string; running: boolean; onAnswer: (text: string) => void };
  /** The last known content, shown while a fresh read runs. */
  unconfirmed: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
}): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6" {...unconfirmedMarker(unconfirmed)}>
      {hasOlder && (
        <Button variant="outline" pending={loadingOlder} onClick={onLoadOlder}>
          Frühere Nachrichten laden
        </Button>
      )}
      <ol aria-label="Verlauf" className="space-y-6">
        {timelineOrder(messages).map((entry) =>
          isMessage(entry) ? (
            <KiMessage key={entry.key} message={entry} />
          ) : (
            <KiRow key={entry.key} row={entry} entries={messages} thread={thread} />
          ),
        )}
      </ol>
    </div>
  );
}
