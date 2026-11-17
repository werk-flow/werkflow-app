import Link from 'next/link';
import { Wrench } from 'lucide-react';

import { SECTION_PRESENTATION } from '@/components/aufgaben/aufgaben-task-section';
import { TaskRow } from '@/components/aufgaben/aufgaben-task-row';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
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

/**
 * The start page's sections in Aufgaben order, then the überfällig
 * maintenance; `overdueMaintenance` is null while its count is not known.
 */
export function OfficeStartSections({
  tasks,
  overdueMaintenance,
}: {
  tasks: readonly AttentionTask[];
  overdueMaintenance: number | null;
}) {
  const sections = groupOfficeStartTasks(tasks);
  return (
    <>
      {sections.length === 0 && overdueMaintenance === 0 && (
        <EmptyState
          size="compact"
          title="Keine offenen Aufgaben."
          description="Nichts offen. Neue Aufgaben erscheinen hier sofort."
        />
      )}
      {sections.map((section) => (
        <OfficeStartSection key={section.key} section={section} />
      ))}
      {overdueMaintenance !== null && overdueMaintenance > 0 && (
        <OverdueMaintenanceSection count={overdueMaintenance} />
      )}
    </>
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
