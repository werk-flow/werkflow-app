'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BriefcaseBusiness, Plus } from 'lucide-react';

import { useServerAction } from '@/hooks/use-server-action';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { describeFailure } from '@/lib/action-messages';
import { deleteEmploymentCondition } from '@/lib/personnel/actions';
import { getBusinessTodayIso, getEffectiveCondition, type EmploymentCondition } from '@/lib/personnel/types';
import { EmploymentConditionDeleteDialog } from './employment-condition-delete-dialog';
import { EmploymentConditionDialog } from './employment-condition-dialog';
import { CONDITION_ERROR_MESSAGES } from './employment-condition-format';
import { EmploymentConditionListItem } from './employment-condition-list-item';
import { SectionTitle } from '@/components/shared/section-title';

type DialogState = { mode: 'closed' } | { mode: 'add' } | { mode: 'edit'; condition: EmploymentCondition };

interface EmploymentConditionsSectionProps {
  recordId: string;
  conditions: EmploymentCondition[];
  canEdit: boolean;
}

export function EmploymentConditionsSection({
  recordId,
  conditions,
  canEdit,
}: EmploymentConditionsSectionProps) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [dialogState, setDialogState] = useState<DialogState>({ mode: 'closed' });
  const [deleteTarget, setDeleteTarget] = useState<EmploymentCondition | null>(null);
  const { run: runDelete, isPending: isDeleting } = useServerAction(deleteEmploymentCondition);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const current = getEffectiveCondition(conditions);
  const sorted = [...conditions].sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  const todayIso = getBusinessTodayIso();

  const handleDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setDeleteError(null);
    const result = await runDelete(deleteTarget.id).catch(() => ({
      success: false as const,
      error: undefined,
    }));
    if (result.success) {
      setDeleteTarget(null);
      showBanner({
        variant: 'success',
        message: 'Die Kondition wurde gelöscht.',
      });
      router.refresh();
    } else {
      setDeleteError(
        describeFailure(
          result.error ?? '',
          CONDITION_ERROR_MESSAGES,
          'Die Kondition konnte nicht gelöscht werden.',
        ),
      );
    }
  };

  return (
    <div className="rounded-lg border bg-card p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle icon={<BriefcaseBusiness className="size-4" />}>Beschäftigung</SectionTitle>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setDialogState({ mode: 'add' })}
          >
            <Plus className="size-3.5" />
            Kondition hinzufügen
          </Button>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          Noch keine Angaben zur Beschäftigung. Konditionen gelten ab ihrem Datum und ändern rückwirkend
          nichts an früheren Zeiträumen.
        </p>
      ) : (
        <ul className="grid gap-2">
          {sorted.map((condition) => (
            <EmploymentConditionListItem
              key={condition.id}
              condition={condition}
              isCurrent={current?.id === condition.id}
              isScheduled={condition.validFrom > todayIso}
              canEdit={canEdit}
              onEdit={() => setDialogState({ mode: 'edit', condition })}
              onDelete={() => {
                setDeleteError(null);
                setDeleteTarget(condition);
              }}
            />
          ))}
        </ul>
      )}

      {dialogState.mode !== 'closed' && (
        <EmploymentConditionDialog
          recordId={recordId}
          condition={dialogState.mode === 'edit' ? dialogState.condition : null}
          onClose={(saved) => {
            setDialogState({ mode: 'closed' });
            if (saved) router.refresh();
          }}
        />
      )}

      <EmploymentConditionDeleteDialog
        deleteTarget={deleteTarget}
        deleteError={deleteError}
        isDeleting={isDeleting}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onDelete={handleDelete}
      />
    </div>
  );
}
