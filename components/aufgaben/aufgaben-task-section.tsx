import {
  CalendarClock,
  ClipboardCheck,
  Clock,
  Inbox,
  MessageSquare,
  Palmtree,
  ParkingSquare,
  Send,
  TriangleAlert,
  UserPlus,
} from 'lucide-react';

import { Card } from '@/components/ui/card';
import type { AttentionTask } from '@/lib/attention/types';
import { TaskRow } from './aufgaben-task-row';

function groupAttentionTasks(tasks: AttentionTask[]) {
  const timeTasks = tasks.filter(
    (task) =>
      task.sourceType === 'time_session_approval' ||
      task.sourceType === 'time_change_request_approval' ||
      task.sourceType === 'time_correction_approval',
  );
  const vacationTasks = tasks.filter((task) => task.sourceType === 'vacation_request_approval');
  const requestTasks = tasks.filter((task) => task.sourceType === 'client_request_open');
  const followUpTasks = tasks.filter((task) => task.sourceType === 'client_follow_up');
  const dispatchAcknowledgementTasks = tasks.filter((task) => task.sourceType === 'dispatch_acknowledgement');
  const dispatchChallengeTasks = tasks.filter((task) => task.sourceType === 'dispatch_challenge_open');
  const parkingReviewTasks = tasks.filter((task) => task.sourceType === 'work_blocker_review');
  const artifactReviewTasks = tasks.filter((task) => task.sourceType === 'work_artifact_review');
  const artifactCorrectionTasks = tasks.filter((task) => task.sourceType === 'work_artifact_correction');
  const dueDefectTasks = tasks.filter((task) => task.sourceType === 'work_defect_due');
  const handoverTasks = tasks.filter((task) => task.sourceType === 'work_handover_review');
  const joinRequestTasks = tasks.filter((task) => task.sourceType === 'organization_join_request');

  return {
    timeTasks,
    vacationTasks,
    requestTasks,
    followUpTasks,
    dispatchAcknowledgementTasks,
    dispatchChallengeTasks,
    parkingReviewTasks,
    artifactReviewTasks,
    artifactCorrectionTasks,
    dueDefectTasks,
    handoverTasks,
    joinRequestTasks,
  };
}

export function AufgabenTaskSection({ tasks }: { tasks: AttentionTask[] }) {
  const {
    timeTasks,
    vacationTasks,
    requestTasks,
    followUpTasks,
    dispatchAcknowledgementTasks,
    dispatchChallengeTasks,
    parkingReviewTasks,
    artifactReviewTasks,
    artifactCorrectionTasks,
    dueDefectTasks,
    handoverTasks,
    joinRequestTasks,
  } = groupAttentionTasks(tasks);

  return (
    <section className="space-y-4" aria-labelledby="aufgaben-heading">
      <h2 id="aufgaben-heading" className="text-sm font-semibold">
        Offene Aufgaben
      </h2>

      {tasks.length === 0 && <p className="text-sm text-muted-foreground">Keine offenen Aufgaben.</p>}

      {joinRequestTasks.length > 0 && (
        <TaskGroup
          icon={<UserPlus className="size-4" />}
          title="Beitrittsanfragen"
          testId="attention-join-request-tasks"
        >
          {joinRequestTasks.map((task) => (
            <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
          ))}
        </TaskGroup>
      )}

      {dispatchAcknowledgementTasks.length > 0 && (
        <TaskGroup
          icon={<Send className="size-4" />}
          title="Einsätze bestätigen"
          testId="attention-dispatch-tasks"
        >
          {dispatchAcknowledgementTasks.map((task) => (
            <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
          ))}
        </TaskGroup>
      )}

      {dispatchChallengeTasks.length > 0 && (
        <TaskGroup
          icon={<MessageSquare className="size-4" />}
          title="Offene Rückfragen"
          testId="attention-dispatch-challenge-tasks"
        >
          {dispatchChallengeTasks.map((task) => (
            <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
          ))}
        </TaskGroup>
      )}

      {parkingReviewTasks.length > 0 && (
        <TaskGroup
          icon={<ParkingSquare className="size-4" />}
          title="Wiedervorlagen"
          testId="attention-parking-review-tasks"
        >
          {parkingReviewTasks.map((task) => (
            <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
          ))}
        </TaskGroup>
      )}

      {(artifactReviewTasks.length > 0 || artifactCorrectionTasks.length > 0) && (
        <TaskGroup
          icon={<ClipboardCheck className="size-4" />}
          title="Arbeitsnachweise"
          testId="attention-work-artifact-tasks"
        >
          {[...artifactReviewTasks, ...artifactCorrectionTasks].map((task) => (
            <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
          ))}
        </TaskGroup>
      )}

      {handoverTasks.length > 0 && (
        <TaskGroup
          icon={<ClipboardCheck className="size-4" />}
          title="Übergaben prüfen"
          testId="attention-work-handover-tasks"
        >
          {handoverTasks.map((task) => (
            <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
          ))}
        </TaskGroup>
      )}

      {dueDefectTasks.length > 0 && (
        <TaskGroup
          icon={<TriangleAlert className="size-4" />}
          title="Fällige Mängel"
          testId="attention-work-defect-tasks"
        >
          {dueDefectTasks.map((task) => (
            <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
          ))}
        </TaskGroup>
      )}

      {timeTasks.length > 0 && (
        <TaskGroup icon={<Clock className="size-4" />} title="Zeitfreigaben" testId="attention-time-tasks">
          {timeTasks.map((task) => (
            <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
          ))}
        </TaskGroup>
      )}

      {vacationTasks.length > 0 && (
        <TaskGroup
          icon={<Palmtree className="size-4" />}
          title="Urlaubsanträge"
          testId="attention-vacation-tasks"
        >
          {vacationTasks.map((task) => (
            <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
          ))}
        </TaskGroup>
      )}

      {requestTasks.length > 0 && (
        <TaskGroup
          icon={<Inbox className="size-4" />}
          title="Offene Anfragen"
          testId="attention-request-tasks"
        >
          {requestTasks.map((task) => (
            <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
          ))}
        </TaskGroup>
      )}

      {followUpTasks.length > 0 && (
        <TaskGroup
          icon={<CalendarClock className="size-4" />}
          title="Nachfassaktionen"
          testId="attention-follow-up-tasks"
        >
          {followUpTasks.map((task) => (
            <TaskRow key={`${task.sourceType}:${task.sourceId}`} task={task} />
          ))}
        </TaskGroup>
      )}
    </section>
  );
}

function TaskGroup({
  icon,
  title,
  testId,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2" data-testid={testId}>
      <h3 className="flex items-center gap-1.5 px-1 text-sm font-medium text-muted-foreground">
        {icon}
        {title}
      </h3>
      <Card className="gap-0 divide-y py-0">{children}</Card>
    </div>
  );
}
