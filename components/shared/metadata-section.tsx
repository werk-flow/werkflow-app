'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { Pencil, Loader2, RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { TimeInput } from '@/components/ui/time-input';
import { DurationHoursInput } from '@/components/ui/duration-hours-input';
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
import { toLocalDateString } from '@/lib/utils';

export interface MetadataField {
  label: string;
  value: React.ReactNode;
  editableConfig?: {
    type: 'text' | 'textarea' | 'select' | 'date' | 'time' | 'duration';
    currentValue: string;
    onSave: (newValue: string) => Promise<void>;
    options?: { value: string; label: string }[];
    placeholder?: string;
    nullable?: boolean;
    confirmBeforeSave?: {
      shouldConfirm: (newValue: string, currentValue: string) => boolean;
      title: string;
      description: ReactNode;
      confirmLabel?: string;
      loadingLabel?: string;
    };
  };
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

export function MetadataSection({
  title,
  fields,
  isEditable,
}: MetadataSectionProps) {
  const [editingFieldLabel, setEditingFieldLabel] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [pendingFieldLabel, setPendingFieldLabel] = useState<string | null>(null);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [pendingSaveConfirmation, setPendingSaveConfirmation] =
    useState<PendingSaveConfirmation | null>(null);
  const [isPending, startTransition] = useTransition();

  const currentEditingField = useMemo(
    () => fields.find((field) => field.label === editingFieldLabel) ?? null,
    [editingFieldLabel, fields]
  );
  const currentConfig = currentEditingField?.editableConfig;
  const hasUnsavedChanges = currentConfig
    ? editValue !== currentConfig.currentValue
    : false;

  const openFieldEditor = (fieldLabel: string) => {
    const nextField = fields.find((field) => field.label === fieldLabel);
    if (!nextField?.editableConfig) return;

    setEditingFieldLabel(fieldLabel);
    setEditValue(nextField.editableConfig.currentValue);
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

  const handleCancelEditing = () => {
    setEditingFieldLabel(null);
    setEditValue('');
  };

  const persistFieldValue = (value: string, onSave: (newValue: string) => Promise<void>) => {
    startTransition(async () => {
      try {
        await onSave(value);
        setEditingFieldLabel(null);
        setEditValue('');
      } catch (error) {
        console.error(
          `Failed to save metadata field "${currentEditingField?.label ?? 'unknown'}"`,
          error
        );
      }
    });
  };

  const handleSave = () => {
    if (!currentConfig) return;

    const confirmation = currentConfig.confirmBeforeSave;
    if (confirmation?.shouldConfirm(editValue, currentConfig.currentValue)) {
      setPendingSaveConfirmation({
        title: confirmation.title,
        description: confirmation.description,
        confirmLabel: confirmation.confirmLabel ?? 'Speichern',
        loadingLabel: confirmation.loadingLabel ?? 'Wird gespeichert...',
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

  return (
    <>
      <div className="rounded-lg border bg-card p-4 sm:p-5">
        {title && (
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </h3>
        )}
        <div className="grid gap-3">
          {fields.map((field) => (
            <MetadataFieldRow
              key={field.label}
              field={field}
              isEditable={isEditable}
              isEditing={editingFieldLabel === field.label}
              editValue={editingFieldLabel === field.label ? editValue : ''}
              isPending={isPending}
              onStartEditing={() => requestStartEditing(field.label)}
              onEditValueChange={setEditValue}
              onSave={handleSave}
              onCancel={handleCancelEditing}
            />
          ))}
        </div>
      </div>
      <AlertDialog open={showDiscardDialog} onOpenChange={handleDiscardDialogChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ungespeicherte Änderungen verwerfen?</AlertDialogTitle>
            <AlertDialogDescription>
              Deine aktuellen Änderungen wurden noch nicht gespeichert. Wenn du ein
              anderes Feld bearbeitest, gehen diese Änderungen verloren.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zurück</AlertDialogCancel>
            <AlertDialogAction onClick={handleDiscardAndContinue}>
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
    const clearDisabled = !editValue.trim() || isPending;
    return (
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {field.label}
        </span>
        <div
          className={
            supportsInlineActions
              ? 'flex flex-col gap-2 sm:flex-row sm:items-start'
              : 'grid gap-2'
          }
        >
          <div className="min-w-0 flex-1">
            {config.type === 'text' && (
              <Input
                value={editValue}
                onChange={(e) => onEditValueChange(e.target.value)}
                placeholder={config.placeholder}
                autoFocus
                disabled={isPending}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && hasChanges) onSave();
                  if (e.key === 'Escape') onCancel();
                }}
              />
            )}
            {config.type === 'duration' && (
              <DurationHoursInput
                value={editValue}
                onChange={onEditValueChange}
                placeholder={config.placeholder}
                autoFocus
                disabled={isPending}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && hasChanges) onSave();
                  if (e.key === 'Escape') onCancel();
                }}
              />
            )}
            {config.type === 'textarea' && (
              <Textarea
                value={editValue}
                onChange={(e) => onEditValueChange(e.target.value)}
                placeholder={config.placeholder}
                autoFocus
                disabled={isPending}
                rows={3}
              />
            )}
            {config.type === 'select' && (
              <Select
                value={editValue}
                onValueChange={onEditValueChange}
                disabled={isPending}
              >
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
            )}
            {config.type === 'date' && (
              <DatePicker
                value={editValue ? new Date(editValue) : undefined}
                onChange={(date) =>
                  onEditValueChange(
                    date ? toLocalDateString(date) : ''
                  )
                }
                disabled={isPending}
              />
            )}
            {config.type === 'time' && (
              <TimeInput
                value={editValue}
                onChange={onEditValueChange}
                disabled={isPending}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && hasChanges) {
                    e.preventDefault();
                    onSave();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancel();
                  }
                }}
              />
            )}
          </div>
          <div
            className={
              supportsInlineActions
                ? 'flex shrink-0 flex-wrap items-center gap-2 sm:pt-0.5'
                : 'flex flex-wrap items-center justify-end gap-2'
            }
          >
            {canClear && (
              <Button
                type="button"
                variant="ghost"
                className="gap-1.5"
                onClick={() => onEditValueChange('')}
                disabled={clearDisabled}
              >
                <RotateCcw className="size-3.5" />
                Leeren
              </Button>
            )}
            <Button
              type="button"
              variant="default"
              onClick={onSave}
              disabled={isPending || !hasChanges}
            >
              {isPending && (
                <Loader2 className="mr-2 size-3.5 animate-spin" />
              )}
              Speichern
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isPending}
            >
              Abbrechen
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group grid gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">
        {field.label}
      </span>
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 text-sm">{field.value ?? '—'}</span>
        {canEdit && (
          <button
            type="button"
            onClick={onStartEditing}
            aria-label={`${field.label} bearbeiten`}
            disabled={isPending}
            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-100 transition-opacity hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100"
          >
            <Pencil className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}
