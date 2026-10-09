'use client';

import { CreateAuftragProjectDialog } from '../forms/create-auftrag-project-dialog';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { QualificationWarningDialog } from '../shared/qualification-warning-dialog';
import type { useAuftraegeOptimisticList } from './use-auftraege-optimistic-list';

type AuftraegeCreateDialogsProps = {
  members: OrgMemberOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: Pick<
    ReturnType<typeof useAuftraegeOptimisticList>,
    | 'dialogJobs'
    | 'handleJobSubmit'
    | 'handleProjectSubmit'
    | 'jobCreateAwaitingApproval'
    | 'isCreatingJob'
    | 'handleJobCreateCancel'
    | 'runJobCreate'
  >;
};

/** The deferred create dialog and the qualification confirm step a job create can end in. */
export function AuftraegeCreateDialogs({ members, open, onOpenChange, list }: AuftraegeCreateDialogsProps) {
  const { jobCreateAwaitingApproval, runJobCreate } = list;

  return (
    <>
      <CreateAuftragProjectDialog
        members={members}
        jobs={list.dialogJobs}
        open={open}
        onOpenChange={onOpenChange}
        onJobSubmit={list.handleJobSubmit}
        onProjectSubmit={list.handleProjectSubmit}
      />
      <QualificationWarningDialog
        evaluation={jobCreateAwaitingApproval?.evaluation ?? null}
        isSubmitting={list.isCreatingJob}
        onCancel={list.handleJobCreateCancel}
        onConfirm={(approval) =>
          jobCreateAwaitingApproval ? runJobCreate(jobCreateAwaitingApproval, approval) : undefined
        }
      />
    </>
  );
}
