'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Check, X, Loader2 } from 'lucide-react';
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
import { toLocalDateString } from '@/lib/utils';

export interface MetadataField {
  label: string;
  value: React.ReactNode;
  editableConfig?: {
    type: 'text' | 'textarea' | 'select' | 'date';
    currentValue: string;
    onSave: (newValue: string) => Promise<void>;
    options?: { value: string; label: string }[];
    placeholder?: string;
  };
}

interface MetadataSectionProps {
  title?: string;
  fields: MetadataField[];
  isEditable: boolean;
}

export function MetadataSection({
  title,
  fields,
  isEditable,
}: MetadataSectionProps) {
  return (
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
          />
        ))}
      </div>
    </div>
  );
}

function MetadataFieldRow({
  field,
  isEditable,
}: {
  field: MetadataField;
  isEditable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const canEdit = isEditable && !!field.editableConfig;

  const startEditing = () => {
    if (!field.editableConfig) return;
    setEditValue(field.editableConfig.currentValue);
    setEditing(true);
  };

  const handleSave = () => {
    if (!field.editableConfig) return;
    startTransition(async () => {
      await field.editableConfig!.onSave(editValue);
      setEditing(false);
      router.refresh();
    });
  };

  const handleCancel = () => {
    setEditing(false);
  };

  if (editing && field.editableConfig) {
    const config = field.editableConfig;
    return (
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {field.label}
        </span>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {config.type === 'text' && (
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder={config.placeholder}
                autoFocus
                disabled={isPending}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                  if (e.key === 'Escape') handleCancel();
                }}
              />
            )}
            {config.type === 'textarea' && (
              <Textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder={config.placeholder}
                autoFocus
                disabled={isPending}
                rows={3}
              />
            )}
            {config.type === 'select' && (
              <Select
                value={editValue}
                onValueChange={setEditValue}
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
                  setEditValue(
                    date ? toLocalDateString(date) : ''
                  )
                }
                disabled={isPending}
              />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1 pt-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={handleSave}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={handleCancel}
              disabled={isPending}
            >
              <X className="size-3.5" />
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
            onClick={startEditing}
            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          >
            <Pencil className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}
