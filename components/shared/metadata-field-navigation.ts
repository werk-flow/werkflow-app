import type { MetadataField, MetadataSectionState } from '@/components/shared/metadata-section';

/** Opening, switching, typing in and leaving a field's editor, with the discard question for unsaved changes. */
export function createFieldNavigationHandlers(fields: MetadataField[], state: MetadataSectionState) {
  const { editingFieldLabel, pendingFieldLabel, isPending, hasUnsavedChanges } = state;
  const { setEditingFieldLabel, setEditValue, setPendingFieldLabel, setShowDiscardDialog, setSaveError } =
    state;

  const openFieldEditor = (fieldLabel: string) => {
    const nextField = fields.find((field) => field.label === fieldLabel);
    if (!nextField?.editableConfig) return;

    setEditingFieldLabel(fieldLabel);
    setEditValue(nextField.editableConfig.currentValue);
    setSaveError(null);
  };

  const requestStartEditing = (fieldLabel: string) => {
    if (isPending) return;
    if (fieldLabel === editingFieldLabel) return;

    if (editingFieldLabel && hasUnsavedChanges) {
      setPendingFieldLabel(fieldLabel);
      setShowDiscardDialog(true);
      return;
    }

    openFieldEditor(fieldLabel);
  };

  const handleDiscardAndContinue = () => {
    if (!pendingFieldLabel) return;
    openFieldEditor(pendingFieldLabel);
    setPendingFieldLabel(null);
    setShowDiscardDialog(false);
  };

  const handleDiscardDialogChange = (open: boolean) => {
    setShowDiscardDialog(open);
    if (!open) {
      setPendingFieldLabel(null);
    }
  };

  const handleEditValueChange = (value: string) => {
    setEditValue(value);
    setSaveError(null);
  };

  const handleCancelEditing = () => {
    setEditingFieldLabel(null);
    setEditValue('');
    setSaveError(null);
  };

  return {
    requestStartEditing,
    handleDiscardAndContinue,
    handleDiscardDialogChange,
    handleEditValueChange,
    handleCancelEditing,
  };
}
