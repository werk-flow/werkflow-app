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
  })),
  [],
  [],
  [],
  [],
);

export function TaskSectionsContractFixture() {
  return <AufgabenTaskSection tasks={HANDOVER_TASKS} />;
}
