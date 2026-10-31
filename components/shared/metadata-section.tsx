'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { useServerAction } from '@/hooks/use-server-action';
import { Pencil } from 'lucide-react';
import { ErrorText } from '@/components/ui/error-text';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SectionTitle } from '@/components/shared/section-title';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/ui/date-picker';
import { DurationHoursInput } from '@/components/ui/duration-hours-input';
import { toLocalDateString } from '@/lib/utils';
import { focusOnMount } from '@/lib/ui/focus-on-mount';
import {
  MetadataFieldActions,
  MetadataTimeControl,
  type MetadataFieldConfig,
  type MetadataFieldEditorProps,
} from '@/components/shared/metadata-field-editor';
import { createFieldNavigationHandlers } from '@/components/shared/metadata-field-navigation';

export class MetadataSaveError extends Error {
  override name = 'MetadataSaveError';
}

export interface MetadataField {
  label: string;
  value: React.ReactNode;
  editableConfig?:
    | {
        type: 'text' | 'textarea' | 'select' | 'date' | 'time' | 'duration';
        currentValue: string;
        onSave: (newValue: string) => Promise<void>;
        options?: { value: string; label: string }[] | undefined;
        placeholder?: string | undefined;
        nullable?: boolean | undefined;
        confirmBeforeSave?: {
          shouldConfirm: (newValue: string, currentValue: string) => boolean;
          title: string;
          description: ReactNode;
          confirmLabel?: string;
          loadingLabel?: string;
        };
      }
    | undefined;
}

interface MetadataSectionProps {
  title?: string;
  fields: MetadataField[];
  isEditable: boolean;
}

type PendingSaveConfirmation = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  loadingLabel: string;
  newValue: string;
  onSave: (newValue: string) => Promise<void>;
};

/** Edit, discard and save-confirmation state of a metadata section. */
function useMetadataSectionState(fields: MetadataField[]) {
  const [editingFieldLabel, setEditingFieldLabel] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [pendingFieldLabel, setPendingFieldLabel] = useState<string | null>(null);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [pendingSaveConfirmation, setPendingSaveConfirmation] = useState<PendingSaveConfirmation | null>(
    null,
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const titleId = useId();
  // Pending state binds to the awaited server call and nothing else
  // (docs/technical/realtime-and-caching.md#add-a-mutation; the P1-16 defect this section fixed).
  const { run: runSave, isPending } = useServerAction(
    async (value: string, onSave: (newValue: string) => Promise<void>) => {
      await onSave(value);
    },
  );

  const currentEditingField = useMemo(
    () => fields.find((field) => field.label === editingFieldLabel) ?? null,
    [editingFieldLabel, fields],
  );
  const currentConfig = currentEditingField?.editableConfig;
  const hasUnsavedChanges = currentConfig ? editValue !== currentConfig.currentValue : false;

  return {
    editingFieldLabel,
    setEditingFieldLabel,
    editValue,
    setEditValue,
    pendingFieldLabel,
    setPendingFieldLabel,
    showDiscardDialog,
    setShowDiscardDialog,
    pendingSaveConfirmation,
    setPendingSaveConfirmation,
    saveError,
    setSaveError,
    titleId,
    runSave,
    isPending,
    currentConfig,
    hasUnsavedChanges,
  };
}

export type MetadataSectionState = ReturnType<typeof useMetadataSectionState>;

/** Saving the edited value, behind the field's confirmation question when it asks for one. */
function createFieldSaveHandlers(state: MetadataSectionState) {
  const { editValue, currentConfig, pendingSaveConfirmation, runSave } = state;
  const { setEditingFieldLabel, setEditValue, setPendingSaveConfirmation, setSaveError } = state;

  const persistFieldValue = (value: string, onSave: (newValue: string) => Promise<void>) => {
    setSaveError(null);
    void (async () => {
      try {
        await runSave(value, onSave);
        setEditingFieldLabel(null);
        setEditValue('');
      } catch (error) {
        setSaveError(
          error instanceof MetadataSaveError
            ? error.message
            : 'Die Änderung konnte nicht gespeichert werden.',
        );
      }
    })();
  };

  const handleSave = () => {
    if (!currentConfig) return;

    const confirmation = currentConfig.confirmBeforeSave;
    if (confirmation?.shouldConfirm(editValue, currentConfig.currentValue)) {
      setPendingSaveConfirmation({
        title: confirmation.title,
        description: confirmation.description,
        confirmLabel: confirmation.confirmLabel ?? 'Speichern',
        loadingLabel: confirmation.loadingLabel ?? 'Wird gespeichert…',
        newValue: editValue,
        onSave: currentConfig.onSave,
      });
      return;
    }

    persistFieldValue(editValue, currentConfig.onSave);
  };

  const handleConfirmSave = () => {
    if (!pendingSaveConfirmation) return;
    const confirmation = pendingSaveConfirmation;
    setPendingSaveConfirmation(null);
    persistFieldValue(confirmation.newValue, confirmation.onSave);
  };

  return { handleSave, handleConfirmSave };
}

export function MetadataSection({ title, fields, isEditable }: MetadataSectionProps) {
  const state = useMetadataSectionState(fields);
  const { editingFieldLabel, editValue, saveError, isPending, titleId } = state;
  const { showDiscardDialog, pendingSaveConfirmation, setPendingSaveConfirmation } = state;
  const navigation = createFieldNavigationHandlers(fields, state);
  const { handleSave, handleConfirmSave } = createFieldSaveHandlers(state);

  return (
    <>
      <div
        className="rounded-lg border bg-card p-4 sm:p-5"
        role={title ? 'region' : undefined}
        aria-labelledby={title ? titleId : undefined}
      >
        {title && (
          <SectionTitle as="h2" id={titleId} className="mb-3">
            {title}
          </SectionTitle>
        )}
        <div className="grid gap-3">
          {fields.map((field) => (
            <MetadataFieldRow
              key={field.label}
              field={field}
              isEditable={isEditable}
              isEditing={editingFieldLabel === field.label}
              editValue={editingFieldLabel === field.label ? editValue : ''}
              saveError={editingFieldLabel === field.label ? saveError : null}
              isPending={isPending}
              onStartEditing={() => navigation.requestStartEditing(field.label)}
              onEditValueChange={navigation.handleEditValueChange}
              onSave={handleSave}
              onCancel={navigation.handleCancelEditing}
            />
          ))}
        </div>
      </div>
      <AlertDialog open={showDiscardDialog} onOpenChange={navigation.handleDiscardDialogChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ungespeicherte Änderungen verwerfen?</AlertDialogTitle>
            <AlertDialogDescription>
              Deine aktuellen Änderungen wurden noch nicht gespeichert. Wenn du ein anderes Feld bearbeitest,
              gehen diese Änderungen verloren.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zurück</AlertDialogCancel>
            <AlertDialogAction onClick={navigation.handleDiscardAndContinue}>
              Verwerfen und wechseln
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pendingSaveConfirmation !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSaveConfirmation(null);
        }}
        pending={isPending}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingSaveConfirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>{pendingSaveConfirmation?.description}</div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSave} disabled={isPending}>
              {isPending ? pendingSaveConfirmation?.loadingLabel : pendingSaveConfirmation?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MetadataFieldRow({
  field,
  isEditable,
  isEditing,
  editValue,
  saveError,
  isPending,
  onStartEditing,
  onEditValueChange,
  onSave,
  onCancel,
}: {
  field: MetadataField;
  isEditable: boolean;
  isEditing: boolean;
  editValue: string;
  saveError: string | null;
  isPending: boolean;
  onStartEditing: () => void;
  onEditValueChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const canEdit = isEditable && !!field.editableConfig;

  if (isEditing && field.editableConfig) {
    const config = field.editableConfig;
    const hasChanges = editValue !== config.currentValue;
    const supportsInlineActions = config.type !== 'textarea';
    const canClear = config.nullable;
    const editorProps = { hasChanges, isPending, onEditValueChange, onSave, onCancel };
    return (
      <div className="grid gap-1.5" role="group" aria-label={field.label}>
        <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
        <div
          className={supportsInlineActions ? 'flex flex-col gap-2 sm:flex-row sm:items-start' : 'grid gap-2'}
        >
          <div className="min-w-0 flex-1">
            <MetadataFieldControl config={config} editValue={editValue} {...editorProps} />
          </div>
          <MetadataFieldActions
            supportsInlineActions={supportsInlineActions}
            canClear={canClear}
            editValue={editValue}
            {...editorProps}
          />
        </div>
        <ErrorText>{saveError}</ErrorText>
      </div>
    );
  }

  return (
    <div className="group grid min-w-0 gap-0.5" role="group" aria-label={field.label}>
      <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 break-words text-sm">{field.value ?? '—'}</span>
        {canEdit && (
          <PlainButton
            type="button"
            onClick={onStartEditing}
            aria-label={`${field.label} bearbeiten`}
            disabled={isPending}
            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-100 transition-opacity hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100"
          >
            <Pencil className="size-3" />
          </PlainButton>
        )}
      </div>
    </div>
  );
}

function MetadataSelectControl({
  config,
  editValue,
  isPending,
  onEditValueChange,
}: { config: MetadataFieldConfig } & Pick<
  MetadataFieldEditorProps,
  'editValue' | 'isPending' | 'onEditValueChange'
>) {
  // Registry rule: entity-sized lists get search; short fixed
  // enums keep the plain select, which itself throws in
  // development at ten or more options.
  return (config.options?.length ?? 0) > 8 ? (
    <SearchableSelect
      options={config.options ?? []}
      value={editValue}
      onChange={onEditValueChange}
      disabled={isPending}
    />
  ) : (
    <Select value={editValue} onValueChange={onEditValueChange} disabled={isPending}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {config.options?.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The input control of a field in edit mode, chosen by its configured type. */
function MetadataFieldControl({
  config,
  editValue,
  hasChanges,
  isPending,
  onEditValueChange,
  onSave,
  onCancel,
}: { config: MetadataFieldConfig } & MetadataFieldEditorProps) {
  return (
    <>
      {config.type === 'text' && (
        <Input
          ref={focusOnMount}
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          placeholder={config.placeholder}
          disabled={isPending}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hasChanges) onSave();
            if (e.key === 'Escape') onCancel();
          }}
        />
      )}
      {config.type === 'duration' && (
        <DurationHoursInput
          ref={focusOnMount}
          value={editValue}
          onChange={onEditValueChange}
          placeholder={config.placeholder}
          disabled={isPending}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hasChanges) onSave();
            if (e.key === 'Escape') onCancel();
          }}
        />
      )}
      {config.type === 'textarea' && (
        <Textarea
          ref={focusOnMount}
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          placeholder={config.placeholder}
          disabled={isPending}
        />
      )}
      {config.type === 'select' && (
        <MetadataSelectControl
          config={config}
          editValue={editValue}
          isPending={isPending}
          onEditValueChange={onEditValueChange}
        />
      )}
      {config.type === 'date' && (
        <DatePicker
          value={editValue ? new Date(editValue) : undefined}
          onChange={(date) => onEditValueChange(date ? toLocalDateString(date) : '')}
          disabled={isPending}
        />
      )}
      {config.type === 'time' && (
        <MetadataTimeControl
          editValue={editValue}
          hasChanges={hasChanges}
          isPending={isPending}
          onEditValueChange={onEditValueChange}
          onSave={onSave}
          onCancel={onCancel}
        />
      )}
    </>
  );
}
