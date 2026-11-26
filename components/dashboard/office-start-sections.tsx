import Link from 'next/link';

import { SECTION_PRESENTATION } from '@/components/aufgaben/aufgaben-task-section';
import { TaskRow } from '@/components/aufgaben/aufgaben-task-row';
import { OfficeStartSkeleton } from '@/components/loading-states/office-start-skeleton';
import { StaleRegion } from '@/components/shared/stale-region';
import { UsableContent } from '@/components/shared/usable-content';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionError } from '@/components/ui/section-error';
import type { LiveViewState } from '@/hooks/use-live-view';
import {
  attentionSectionHref,
  groupOfficeStartTasks,
  type AttentionTaskSection,
} from '@/lib/attention/task-sections';
import type { AttentionTask } from '@/lib/attention/types';

/** How many items of a section the start page shows before „Alle in Aufgaben“. */
const PREVIEW_ROWS = 3;

/** One live read of the start page, as `useLiveView` reports it. */
export type OfficeStartRead<T> = Pick<
  LiveViewState<T>,
  'data' | 'isLoading' | 'isRefreshing' | 'isStale' | 'refresh'
>;

/**
 * What needs Büro and Admin now, from the Aufgaben overview, due maintenance
 * included. „Nothing open“ needs the read current.
 */
export function OfficeStartView({
  attention,
}: {
  attention: OfficeStartRead<{ tasks: readonly AttentionTask[] }>;
}) {
  const sections = attention.data ? groupOfficeStartTasks(attention.data.tasks) : null;
  const nothingOpen = sections?.length === 0 && !attention.isStale;
  return (
    <section
      className="mx-auto max-w-3xl space-y-6"
      aria-labelledby="office-start-heading"
      data-testid="office-start"
    >
      <h2 id="office-start-heading" className="text-sm font-semibold">
        Was jetzt ansteht
      </h2>
      {nothingOpen && (
        <EmptyState
          size="compact"
          title="Keine offenen Aufgaben."
          description="Nichts offen. Neue Aufgaben erscheinen hier sofort."
        />
      )}
      <AttentionRegion attention={attention} sections={sections} />
    </section>
  );
}

function AttentionRegion({
  attention,
  sections,
}: {
  attention: OfficeStartRead<{ tasks: readonly AttentionTask[] }>;
  sections: AttentionTaskSection[] | null;
}) {
  if (attention.isLoading) return <OfficeStartSkeleton />;
  if (!attention.data || !sections) {
    return (
      <SectionError onRetry={() => void attention.refresh()} retryPending={attention.isRefreshing}>
        Deine offenen Aufgaben konnten nicht geladen werden. Bitte versuche es erneut.
      </SectionError>
    );
  }
  return (
    <UsableContent name="office-start" count={attention.data.tasks.length}>
      {/* A failed refresh keeps the last tasks, marked stale. */}
      {(sections.length > 0 || attention.isStale) && (
        <StaleRegion stale={attention.isStale} onRetry={attention.refresh} className="space-y-6">
          {sections.map((section) => (
            <StartTaskSection key={section.key} section={section} testIdPrefix="office-start" />
          ))}
        </StaleRegion>
      )}
    </UsableContent>
  );
}

/**
 * One Aufgaben section on a start page: its heading with the count, an
 * optional note on why its tasks are here, its first items and the way into
 * Aufgaben. A section that holds only part of its Aufgaben section opens it
 * without promising all of its tasks.
 */
export function StartTaskSection({
  section,
  testIdPrefix,
  note,
  partOfAufgaben = false,
}: {
  section: AttentionTaskSection;
  testIdPrefix: string;
  note?: string | undefined;
  partOfAufgaben?: boolean;
}) {
  const { icon, title, testId } = SECTION_PRESENTATION[section.key];
  const total = section.tasks.length;
  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-${testId}`}>
      <div className="space-y-0.5 px-1">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          {icon}
          {title}
          <span className="tabular-nums">({total})</span>
        </h3>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      <Card className="gap-0 divide-y py-0">
        {section.tasks.slice(0, PREVIEW_ROWS).map((task) => (
          <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
        ))}
        <div className="flex justify-end px-4 py-2">
          <Button asChild variant="ghost" size="sm">
            <Link
              href={attentionSectionHref(section.key)}
              aria-label={
                partOfAufgaben ? `${title}: in Aufgaben öffnen` : `${title}: alle ${total} in Aufgaben`
              }
            >
              {partOfAufgaben ? 'In Aufgaben öffnen' : 'Alle in Aufgaben'}
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
