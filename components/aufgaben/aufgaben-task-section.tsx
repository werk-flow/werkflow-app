'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  AlarmClock,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  ClipboardCheck,
  PhoneCall,
  Clock,
  Inbox,
  MessageSquare,
  Palmtree,
  ParkingSquare,
  Send,
  TriangleAlert,
  UserPlus,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  attentionSectionAnchor,
  groupAttentionTasks,
  type AttentionTaskSection,
  type AttentionTaskSectionKey,
} from '@/lib/attention/task-sections';
import type { AttentionTask } from '@/lib/attention/types';
import { TaskRow } from './aufgaben-task-row';

/** A backlog section shows its first rows; „Alle anzeigen“ opens the rest. */
const BACKLOG_PREVIEW_ROWS = 3;

export const SECTION_PRESENTATION: Record<
  AttentionTaskSectionKey,
  { icon: React.ReactNode; title: string; testId: string; previewRows?: number }
> = {
  callback: {
    icon: <PhoneCall className="size-4" />,
    title: 'Rückruf überfällig',
    testId: 'attention-callback-tasks',
  },
  time: { icon: <Clock className="size-4" />, title: 'Zeitfreigaben', testId: 'attention-time-tasks' },
  vacation: {
    icon: <Palmtree className="size-4" />,
    title: 'Urlaubsanträge',
    testId: 'attention-vacation-tasks',
  },
  visitReplan: {
    icon: <CalendarX className="size-4" />,
    title: 'Einsätze umplanen',
    testId: 'attention-visit-replan-tasks',
  },
  overdueJob: {
    icon: <AlarmClock className="size-4" />,
    title: 'Überfällige Aufträge',
    testId: 'attention-overdue-job-tasks',
    previewRows: BACKLOG_PREVIEW_ROWS,
  },
  request: {
    icon: <Inbox className="size-4" />,
    title: 'Offene Anfragen',
    testId: 'attention-request-tasks',
  },
  joinRequest: {
    icon: <UserPlus className="size-4" />,
    title: 'Beitrittsanfragen',
    testId: 'attention-join-request-tasks',
  },
  siteAccess: {
    icon: <ClipboardCheck className="size-4" />,
    title: 'Zugang prüfen',
    testId: 'attention-site-access-tasks',
  },
  dispatchAcknowledgement: {
    icon: <Send className="size-4" />,
    title: 'Einsätze bestätigen',
    testId: 'attention-dispatch-tasks',
  },
  dispatchChallenge: {
    icon: <MessageSquare className="size-4" />,
    title: 'Offene Rückfragen',
    testId: 'attention-dispatch-challenge-tasks',
  },
  parkingReview: {
    icon: <ParkingSquare className="size-4" />,
    title: 'Wiedervorlagen',
    testId: 'attention-parking-review-tasks',
  },
  followUp: {
    icon: <CalendarClock className="size-4" />,
    title: 'Nachfassaktionen',
    testId: 'attention-follow-up-tasks',
  },
  dueDefect: {
    icon: <TriangleAlert className="size-4" />,
    title: 'Fällige Mängel',
    testId: 'attention-work-defect-tasks',
  },
  artifact: {
    icon: <ClipboardCheck className="size-4" />,
    title: 'Arbeitsnachweise',
    testId: 'attention-work-artifact-tasks',
  },
  unplannedJob: {
    icon: <CalendarPlus className="size-4" />,
    title: 'Aufträge ohne Termin',
    testId: 'attention-unplanned-job-tasks',
    previewRows: BACKLOG_PREVIEW_ROWS,
  },
  handover: {
    icon: <ClipboardCheck className="size-4" />,
    title: 'Übergaben prüfen',
    testId: 'attention-work-handover-tasks',
    previewRows: BACKLOG_PREVIEW_ROWS,
  },
};

export function AufgabenTaskSection({ tasks }: { tasks: AttentionTask[] }) {
  return (
    <section className="space-y-4" aria-labelledby="aufgaben-heading">
      <h2 id="aufgaben-heading" className="text-sm font-semibold">
        Offene Aufgaben
      </h2>

      {tasks.length === 0 && <EmptyState size="compact" title="Keine offenen Aufgaben." />}

      {groupAttentionTasks(tasks).map((section) => (
        <TaskGroup key={section.key} section={section} />
      ))}
    </section>
  );
}

function taskKey(task: AttentionTask): string {
  return `${task.sourceType}:${task.sourceId}`;
}

function TaskGroup({ section }: { section: AttentionTaskSection }) {
  const { icon, title, testId, previewRows } = SECTION_PRESENTATION[section.key];
  const [showAll, setShowAll] = useState(false);
  const restId = useId();
  const anchor = attentionSectionAnchor(section.key);
  const groupRef = useRef<HTMLDivElement>(null);
  // „Alle in Aufgaben“ opens this section: the tasks arrive after the page, so
  // the browser found no target for the hash. The section scrolls itself into view.
  useEffect(() => {
    if (window.location.hash === `#${anchor}`) groupRef.current?.scrollIntoView({ block: 'start' });
  }, [anchor]);
  const total = section.tasks.length;
  const shown = previewRows ?? total;
  const preview = section.tasks.slice(0, shown);
  // „Alle anzeigen“ renders the rest from the overview without a read; a long
  // backlog stays out of the page until then.
  const rest = section.tasks.slice(shown);

  return (
    <div id={anchor} ref={groupRef} className="scroll-mt-4 space-y-2" data-testid={testId}>
      <h3 className="flex items-center gap-1.5 px-1 text-sm font-medium text-muted-foreground">
        {icon}
        {title}
        {previewRows !== undefined && <span className="tabular-nums">({total})</span>}
      </h3>
      <Card className="gap-0 divide-y py-0">
        {preview.map((task) => (
          <TaskRow key={taskKey(task)} task={task} />
        ))}
        {rest.length > 0 && (
          <>
            <div id={restId} hidden={!showAll} className="divide-y">
              {showAll && rest.map((task) => <TaskRow key={taskKey(task)} task={task} />)}
            </div>
            <div className="flex items-center justify-between gap-2 px-4 py-2">
              <p className="text-xs text-muted-foreground tabular-nums">
                {showAll ? `Alle ${total}, die ältesten zuerst` : `Die ${shown} ältesten von ${total}`}
              </p>
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={showAll}
                aria-controls={restId}
                onClick={() => setShowAll((current) => !current)}
              >
                {showAll ? 'Weniger anzeigen' : 'Alle anzeigen'}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
