import Link from 'next/link';
import { Wrench } from 'lucide-react';

import { SECTION_PRESENTATION } from '@/components/aufgaben/aufgaben-task-section';
import { TaskRow } from '@/components/aufgaben/aufgaben-task-row';
import { OfficeStartSkeleton } from '@/components/loading-states/office-start-skeleton';
import { StaleRegion } from '@/components/shared/stale-region';
import { UsableContent } from '@/components/shared/usable-content';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SectionError } from '@/components/ui/section-error';
import type { LiveViewState } from '@/hooks/use-live-view';
import {
  attentionSectionHref,
  groupOfficeStartTasks,
  type AttentionTaskSection,
} from '@/lib/attention/task-sections';
import type { AttentionTask } from '@/lib/attention/types';
import {
  MAINTENANCE_DUE_FILTER_PARAM,
  MAINTENANCE_OVERDUE_FILTER_VALUE,
} from '@/lib/maintenance/workspace-page';

/** How many items of a section the start page shows before „Alle in Aufgaben“. */
const PREVIEW_ROWS = 3;

const OVERDUE_MAINTENANCE_HREF = `/service/wartung?${MAINTENANCE_DUE_FILTER_PARAM}=${MAINTENANCE_OVERDUE_FILTER_VALUE}`;

/** One live read of the start page, as `useLiveView` reports it. */
export type OfficeStartRead<T> = Pick<
  LiveViewState<T>,
  'data' | 'isLoading' | 'isRefreshing' | 'isStale' | 'refresh'
>;

/**
 * What needs Büro and Admin now, from the Aufgaben overview and the überfällig
 * maintenance count. Each read loads, fails and goes stale in its own region
 * with its own retry; „nothing open“ needs both reads current.
 */
export function OfficeStartView({
  attention,
  maintenance,
}: {
  attention: OfficeStartRead<{ tasks: readonly AttentionTask[] }>;
  maintenance: OfficeStartRead<number>;
}) {
  const sections = attention.data ? groupOfficeStartTasks(attention.data.tasks) : null;
  const nothingOpen =
    sections?.length === 0 && !attention.isStale && maintenance.data === 0 && !maintenance.isStale;
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
      <OverdueMaintenanceRegion maintenance={maintenance} />
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
      {/* A failed refresh keeps the last tasks, marked stale; the maintenance count stays usable. */}
      {(sections.length > 0 || attention.isStale) && (
        <StaleRegion stale={attention.isStale} onRetry={attention.refresh} className="space-y-6">
          {sections.map((section) => (
            <OfficeStartSection key={section.key} section={section} />
          ))}
        </StaleRegion>
      )}
    </UsableContent>
  );
}

/** The überfällig maintenance below the sections; nothing while it loads or when none is due. */
function OverdueMaintenanceRegion({ maintenance }: { maintenance: OfficeStartRead<number> }) {
  if (maintenance.isLoading) return null;
  if (maintenance.data === undefined) {
    return (
      <SectionError onRetry={() => void maintenance.refresh()} retryPending={maintenance.isRefreshing}>
        Die überfällige Wartung konnte nicht geladen werden. Bitte versuche es erneut.
      </SectionError>
    );
  }
  if (maintenance.data === 0 && !maintenance.isStale) return null;
  return (
    <StaleRegion stale={maintenance.isStale} onRetry={maintenance.refresh}>
      {maintenance.data > 0 && <OverdueMaintenanceSection count={maintenance.data} />}
    </StaleRegion>
  );
}

function OfficeStartSection({ section }: { section: AttentionTaskSection }) {
  const { icon, title, testId } = SECTION_PRESENTATION[section.key];
  const total = section.tasks.length;
  return (
    <div className="space-y-2" data-testid={`office-start-${testId}`}>
      <h3 className="flex items-center gap-1.5 px-1 text-sm font-medium text-muted-foreground">
        {icon}
        {title}
        <span className="tabular-nums">({total})</span>
      </h3>
      <Card className="gap-0 divide-y py-0">
        {section.tasks.slice(0, PREVIEW_ROWS).map((task) => (
          <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
        ))}
        <div className="flex justify-end px-4 py-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={attentionSectionHref(section.key)} aria-label={`${title}: alle ${total} in Aufgaben`}>
              Alle in Aufgaben
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}

function OverdueMaintenanceSection({ count }: { count: number }) {
  const label = count === 1 ? '1 Wartung überfällig' : `${count} Wartungen überfällig`;
  return (
    <div className="space-y-2" data-testid="office-start-overdue-maintenance">
      <h3 className="flex items-center gap-1.5 px-1 text-sm font-medium text-muted-foreground">
        <Wrench className="size-4" />
        Wartung
        <span className="tabular-nums">({count})</span>
      </h3>
      <Card className="gap-0 py-0">
        <ListRow asChild interactive variant="plain">
          <Link href={OVERDUE_MAINTENANCE_HREF} aria-label={`${label}: Wartungsliste öffnen`}>
            <p className="text-sm font-medium tabular-nums">{label}</p>
            <p className="text-xs text-muted-foreground">Fällig vor heute und noch ohne Ergebnis</p>
          </Link>
        </ListRow>
      </Card>
    </div>
  );
}
