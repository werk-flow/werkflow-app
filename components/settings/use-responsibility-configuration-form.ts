'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ERROR_MESSAGES, responsibilityErrorMessage } from '@/components/settings/responsibility-display';
import { useBanner } from '@/components/ui/banner';
import {
  applyResponsibilityConfiguration,
  previewResponsibilityConfiguration,
  type ResponsibilityPreview,
} from '@/lib/responsibilities/actions';
import type { ResponsibilitySettingsData } from '@/lib/responsibilities/server';
import {
  RESPONSIBILITY_LABELS,
  type OrganizationResponsibility,
  type ResponsibilityConfigurationMode,
} from '@/lib/responsibilities/types';

type ResponsibilityConfigurationForm = {
  mode: ResponsibilityConfigurationMode;
  selectedIds: string[];
  preview: ResponsibilityPreview | null;
  isLoadingPreview: boolean;
  isSaving: boolean;
  changeMode: (nextMode: ResponsibilityConfigurationMode) => void;
  togglePerson: (employeeRecordId: string, nextChecked: boolean | 'indeterminate') => void;
  handleOpenChange: (nextOpen: boolean) => void;
  handlePreview: () => Promise<void>;
  handleSave: () => Promise<void>;
};

/** Mode, selected holders and the previewed effect of one responsibility's configuration dialog. */
export function useResponsibilityConfigurationForm({
  data,
  responsibility,
  onOpenChange,
}: {
  data: ResponsibilitySettingsData;
  responsibility: OrganizationResponsibility;
  onOpenChange: (open: boolean) => void;
}): ResponsibilityConfigurationForm {
  const router = useRouter();
  const { showBanner } = useBanner();
  const current = data.effective[responsibility];
  const baseHolderIds = useMemo(
    () =>
      current.holders
        .filter((holder) => holder.source.kind !== 'delegation')
        .map((holder) => holder.employeeRecordId),
    [current.holders],
  );
  const [mode, setMode] = useState<ResponsibilityConfigurationMode>(current.mode);
  const [selectedIds, setSelectedIds] = useState<string[]>(baseHolderIds);
  const [preview, setPreview] = useState<ResponsibilityPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const reset = () => {
    setMode(current.mode);
    setSelectedIds(baseHolderIds);
    setPreview(null);
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const changeMode = (nextMode: ResponsibilityConfigurationMode) => {
    setMode(nextMode);
    setPreview(null);
  };

  const togglePerson = (employeeRecordId: string, nextChecked: boolean | 'indeterminate') => {
    setSelectedIds((currentIds) =>
      nextChecked ? [...currentIds, employeeRecordId] : currentIds.filter((id) => id !== employeeRecordId),
    );
    setPreview(null);
  };

  const handlePreview = async () => {
    setIsLoadingPreview(true);
    try {
      const result = await previewResponsibilityConfiguration({
        responsibility,
        mode,
        employeeRecordIds: mode === 'selected' ? selectedIds : [],
      });
      if (!result.success) {
        showBanner({
          message: responsibilityErrorMessage(result.error),
          variant: 'error',
        });
        return;
      }
      setPreview(result.preview);
    } catch {
      showBanner({ message: ERROR_MESSAGES.save_failed, variant: 'error' });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleSave = async () => {
    if (!preview) return;
    setIsSaving(true);
    try {
      const result = await applyResponsibilityConfiguration({
        responsibility,
        mode,
        employeeRecordIds: mode === 'selected' ? selectedIds : [],
        expectedConfigurationId: preview.expectedConfigurationId,
      });
      if (!result.success) {
        showBanner({
          message: responsibilityErrorMessage(result.error),
          variant: 'error',
        });
        return;
      }
      handleOpenChange(false);
      router.refresh();
      showBanner({
        message: `${RESPONSIBILITY_LABELS[responsibility]} wurden gespeichert.`,
        variant: 'success',
      });
    } catch {
      showBanner({ message: ERROR_MESSAGES.save_failed, variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return {
    mode,
    selectedIds,
    preview,
    isLoadingPreview,
    isSaving,
    changeMode,
    togglePerson,
    handleOpenChange,
    handlePreview,
    handleSave,
  };
}
