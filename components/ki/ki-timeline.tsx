'use client';

import { memo } from 'react';

import { AiMarkdown } from '@/components/shared/ai-markdown';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Skeleton } from '@/components/ui/skeleton';
import type { AiChatMessage } from '@/lib/ai/thread-types';
import { unconfirmedMarker } from '@/lib/ui/unconfirmed';
import { KiFileCard } from './ki-file-card';

/** A message in the timeline; `unconfirmed` until the server saved it. */
export type TimelineMessage = AiChatMessage & { unconfirmed?: boolean };

/**
 * One message. Memo keeps a finished message from rendering again while
 * another one streams; inside a streaming answer only its last block renders
 * (AiMarkdown, brief non-negotiable 3).
 */
const KiMessage = memo(function KiMessage({
  organizationId,
  message,
}: {
  organizationId: string;
  message: TimelineMessage;
}) {
  if (message.role === 'file')
    return (
      <li {...unconfirmedMarker(message.unconfirmed)}>
        <KiFileCard
          organizationId={organizationId}
          file={message.file}
          unconfirmed={message.unconfirmed === true}
        />
      </li>
    );
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

export function KiTimelineSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-6" aria-hidden="true">
      <Skeleton className="ml-auto h-10 w-2/3 rounded-lg" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="ml-auto h-10 w-1/2 rounded-lg" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

export function KiTimeline({
  organizationId,
  messages,
  unconfirmed,
  hasOlder,
  loadingOlder,
  onLoadOlder,
}: {
  organizationId: string;
  messages: readonly TimelineMessage[];
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
        {messages.map((message) => (
          <KiMessage key={message.key} organizationId={organizationId} message={message} />
        ))}
      </ol>
    </div>
  );
}
