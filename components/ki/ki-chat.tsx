'use client';

import { ArrowLeft, Sparkles, SquarePen } from 'lucide-react';

import { PageBody } from '@/components/shared/page-shell';
import { Button } from '@/components/ui/button';
import { SectionError } from '@/components/ui/section-error';
import { usePendingTask } from '@/hooks/use-server-action';
import { AI_PRODUCT_NAME } from '@/lib/ai/name';
import type { AiThreadWindow } from '@/lib/ai/thread-types';
import { KiComposer } from './ki-composer';
import { KiThreadList } from './ki-thread-list';
import { KiTimeline, KiTimelineSkeleton, type TimelineEntry } from './ki-timeline';
import {
  answerMessage,
  type LiveTurn,
  type ThreadList,
  type ThreadView,
  useKiChat,
  type useThreadList,
} from './use-ki-chat';

/** First contact says that this is AI (B20). */
function KiIntro(): React.JSX.Element {
  return (
    <div className="space-y-2">
      <Sparkles className="size-6 text-muted-foreground" />
      <p className="font-medium">Hallo, ich bin {AI_PRODUCT_NAME}.</p>
      <p className="text-sm text-muted-foreground">
        Ich bin eine KI und kann mich irren. Ich finde für dich Aufträge, Kunden und Artikel in WerkFlow,
        soweit du sie selbst sehen darfst. Ändern kann ich noch nichts.
      </p>
    </div>
  );
}

/** The thread's saved entries with the running turn's messages in place of their saved copies. */
function shownMessages(view: ThreadView | undefined, live: LiveTurn | null): readonly TimelineEntry[] {
  const saved: readonly TimelineEntry[] = view?.window?.messages ?? [];
  if (!live) return saved;
  const turn = live.started ? [live.user, answerMessage(live)] : [live.user];
  const keys = new Set(turn.map((message) => message.key));
  // The turn's rows stay: they come saved, from its stream and its live channel.
  return [...saved.filter((message) => !keys.has(message.key)), ...turn];
}

function KiThreads({
  list,
  threadId,
  onOpen,
}: {
  list: ReturnType<typeof useThreadList>;
  threadId: string | null;
  onOpen: (threadId: string | null) => void;
}): React.JSX.Element {
  return (
    <>
      <KiThreadList
        threads={list.list.threads}
        currentThreadId={threadId}
        hasMore={list.list.hasMore}
        loadingMore={list.loadingMore}
        onOpen={onOpen}
        onLoadMore={list.loadMore}
      />
      {list.failure && <SectionError failure={list.failure} />}
    </>
  );
}

function KiThread({
  organizationId,
  threadId,
  view,
  live,
  onBack,
  onRetry,
  onLoadOlder,
  onAnswer,
}: {
  organizationId: string;
  threadId: string;
  view: ThreadView | undefined;
  live: LiveTurn | null;
  onBack: () => void;
  onRetry: (threadId: string) => void;
  onLoadOlder: (threadId: string, beforeSequence?: number) => Promise<unknown>;
  onAnswer: (text: string) => void;
}): React.JSX.Element {
  const older = usePendingTask();
  const first = view?.window?.messages[0]?.sequence;
  return (
    <>
      <Button variant="link" className="md:hidden" onClick={onBack}>
        <ArrowLeft />
        Alle Chats
      </Button>
      {view?.failed && (
        <SectionError title="Der Chat konnte nicht geladen werden" onRetry={() => onRetry(threadId)}>
          Prüf deine Verbindung und lade ihn noch einmal.
        </SectionError>
      )}
      {view?.window || live ? (
        <KiTimeline
          messages={shownMessages(view, live)}
          thread={{ organizationId, threadId, running: live !== null, onAnswer }}
          unconfirmed={view?.confirmed === false}
          hasOlder={view?.window?.hasOlder ?? false}
          loadingOlder={older.isPending}
          onLoadOlder={() =>
            void older.run(async () => {
              await onLoadOlder(threadId, first);
            })
          }
        />
      ) : (
        !view?.failed && <KiTimelineSkeleton />
      )}
    </>
  );
}

export function KiChat(props: {
  organizationId: string;
  userId: string;
  initialThreadId: string | null;
  initialThreads: ThreadList;
  initialWindow: AiThreadWindow | null;
}): React.JSX.Element {
  const { list, views, readWindow, threadId, show, openThread, turn, draft, error } = useKiChat(props);
  const threads = <KiThreads list={list} threadId={threadId} onOpen={openThread} />;
  return (
    <div className="flex min-h-0 flex-1">
      <aside
        aria-label="Chats"
        className="hidden w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r p-4 md:flex"
      >
        <Button variant="outline" onClick={() => openThread(null)}>
          <SquarePen />
          Neuer Chat
        </Button>
        {threads}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <PageBody maxWidth="content">
          <div className="space-y-6">
            {threadId === null ? (
              <>
                <KiIntro />
                <div className="space-y-2 md:hidden">{threads}</div>
              </>
            ) : (
              <KiThread
                organizationId={props.organizationId}
                threadId={threadId}
                view={views[threadId]}
                live={turn.live?.threadId === threadId ? turn.live : null}
                onBack={() => openThread(null)}
                onRetry={show}
                onLoadOlder={readWindow}
                onAnswer={(text) => turn.send(text, draft, true)}
              />
            )}
          </div>
        </PageBody>
        <KiComposer
          draft={draft}
          running={turn.live !== null && turn.live.threadId === threadId}
          stopping={turn.live !== null && turn.live.stoppedAt !== null}
          error={error}
          onSend={turn.send}
          onStop={turn.stop}
        />
      </div>
    </div>
  );
}
