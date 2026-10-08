'use client';

import { describeFailure } from '@/lib/action-messages';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorText } from '@/components/ui/error-text';
import { Form, FormField } from '@/components/ui/form';
import { InlinePending } from '@/components/ui/inline-pending';
import { useServerAction } from '@/hooks/use-server-action';
import { saveAuftraegeColumnPreferences } from '@/lib/jobs/auftraege-column-preferences-actions';
import {
  AUFTRAEGE_TABLE_COLUMNS,
  auftraegeColumnPreferencesSchema,
  type AuftraegeColumnId,
  type AuftraegeColumnPreferencesValues,
} from '@/lib/jobs/auftraege-table-columns';

const ERROR_MESSAGES = {
  invalid_input: 'Bitte wähle mindestens eine sichtbare Spalte aus.',
  update_failed: 'Die Spalteneinstellungen konnten nicht gespeichert werden.',
} satisfies Record<string, string>;

type AuftraegeColumnSettingsFormProps = {
  initialVisibleColumns: AuftraegeColumnId[];
  organizationName: string;
};

export function AuftraegeColumnSettingsForm({
  initialVisibleColumns,
  organizationName,
}: AuftraegeColumnSettingsFormProps) {
  const { showBanner } = useBanner();
  const { run: runSave, isPending: isSaving } = useServerAction(saveAuftraegeColumnPreferences);

  const form = useForm<AuftraegeColumnPreferencesValues>({
    resolver: zodResolver(auftraegeColumnPreferencesSchema),
    defaultValues: {
      visibleColumns: initialVisibleColumns,
    },
  });

  useEffect(() => {
    form.reset({
      visibleColumns: initialVisibleColumns,
    });
  }, [form, initialVisibleColumns]);

  const toggleColumn = (columnId: AuftraegeColumnId, checked: boolean) => {
    const currentColumns = form.getValues('visibleColumns');
    const nextColumns = checked
      ? [...currentColumns, columnId]
      : currentColumns.filter((column) => column !== columnId);

    form.setValue('visibleColumns', nextColumns, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await runSave(values);

      if (!result.success) {
        showBanner({
          message: describeFailure(result.error, ERROR_MESSAGES, ERROR_MESSAGES.update_failed),
          variant: 'error',
        });
        return;
      }

      // The action's response renders the route with the saved columns.
      form.reset({
        visibleColumns: result.visibleColumns,
      });
      showBanner({
        message: 'Deine Aufträge-Spalten wurden gespeichert.',
        variant: 'success',
      });
    } catch {
      showBanner({ message: ERROR_MESSAGES.update_failed, variant: 'error' });
    }
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Sichtbare Spalten
            <InlinePending active={isSaving} label="Spaltenansicht wird gespeichert" />
          </CardTitle>
          <CardDescription>
            Entscheide pro Organisation selbst, welche Spalten deine Aufträge-Tabelle zeigen soll.
          </CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={onSubmit}>
            <CardContent className="space-y-5 pb-8">
              <FormField
                control={form.control}
                name="visibleColumns"
                render={({ field, fieldState }) => (
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">Tabellenspalten</legend>
                    <p className="text-sm text-muted-foreground">
                      Diese Auswahl gilt nur für dich innerhalb von {organizationName}.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {AUFTRAEGE_TABLE_COLUMNS.map((column) => {
                        const isChecked = field.value.includes(column.id);

                        return (
                          <label
                            key={column.id}
                            className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/30"
                          >
                            <Checkbox
                              checked={isChecked}
                              disabled={isSaving}
                              onCheckedChange={(checked) => toggleColumn(column.id, checked === true)}
                            />
                            <div>
                              <p className="text-sm font-medium leading-none">{column.label}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    <ErrorText>{fieldState.error?.message}</ErrorText>
                  </fieldset>
                )}
              />
            </CardContent>
            <CardFooter className="flex flex-col items-start gap-3 border-t sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Aktionen, Aufklappen und andere strukturelle Bedienelemente bleiben weiterhin immer sichtbar.
              </p>
              <Button type="submit" disabled={isSaving || !form.formState.isDirty}>
                {isSaving ? 'Speichert…' : 'Ansicht speichern'}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
