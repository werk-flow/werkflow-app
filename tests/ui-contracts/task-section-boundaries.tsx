import { useEffect, useState } from 'react';

import { AufgabenTaskSection } from '@/components/aufgaben/aufgaben-task-section';
import { toWorkHandoverTasks } from '@/lib/attention/handover-tasks';

/** Five finished jobs wait for handover review: three show, two wait behind „Alle anzeigen“. */
const HANDOVER_TASKS = toWorkHandoverTasks(
  [1, 2, 3, 4, 5].map((day) => ({
    id: `00000000-0000-4000-8000-00000000000${day}`,
    job_number: `A-2026-00${day}`,
    title: `Wartung ${day}`,
    execution_version: 1,
    project_id: null,
    updated_at: `2026-10-0${day}T08:00:00Z`,
    actual_completion_date: `2026-10-0${day}`,
  })),
  [],
  [],
  [],
  [],
);

export function TaskSectionsContractFixture() {
  return <AufgabenTaskSection tasks={HANDOVER_TASKS} />;
}

/**
 * Aufgaben opened at its handover section: the tasks arrive after the page,
 * as the overview read does, below a page of other content.
 */
export function TaskSectionsAnchorContractFixture() {
  const [tasks, setTasks] = useState<typeof HANDOVER_TASKS>([]);
  useEffect(() => {
    const timer = setTimeout(() => setTasks(HANDOVER_TASKS), 300);
    return () => clearTimeout(timer);
  }, []);
  return (
    <>
      <div style={{ height: 3000 }} />
      <AufgabenTaskSection tasks={tasks} />
    </>
  );
}
