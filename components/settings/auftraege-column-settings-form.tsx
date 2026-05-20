'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'

import { useSettingsBanner } from '@/components/settings/settings-banner-provider'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { saveAuftraegeColumnPreferences } from '@/lib/jobs/auftraege-column-preferences-actions'
import {
  AUFTRAEGE_TABLE_COLUMNS,
  auftraegeColumnPreferencesSchema,
  type AuftraegeColumnId,
  type AuftraegeColumnPreferencesValues,
} from '@/lib/jobs/auftraege-table-columns'

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Du bist nicht angemeldet.',
  no_active_org: 'Es ist keine aktive Organisation ausgewählt.',
  not_a_member: 'Du bist kein Mitglied der aktiven Organisation.',
  invalid_input: 'Bitte wähle mindestens eine sichtbare Spalte aus.',
  update_failed: 'Die Spalteneinstellungen konnten nicht gespeichert werden.',
}

type AuftraegeColumnSettingsFormProps = {
  initialVisibleColumns: AuftraegeColumnId[]
  organizationName: string
}

export function AuftraegeColumnSettingsForm({
  initialVisibleColumns,
  organizationName,
}: AuftraegeColumnSettingsFormProps) {
  const router = useRouter()
  const { showBanner } = useSettingsBanner()
  const [isSaving, setIsSaving] = useState(false)

  const form = useForm<AuftraegeColumnPreferencesValues>({
    resolver: zodResolver(auftraegeColumnPreferencesSchema),
    defaultValues: {
      visibleColumns: initialVisibleColumns,
    },
  })

  useEffect(() => {
    form.reset({
      visibleColumns: initialVisibleColumns,
    })
  }, [form, initialVisibleColumns])

  const toggleColumn = (columnId: AuftraegeColumnId, checked: boolean) => {
    const currentColumns = form.getValues('visibleColumns')
    const nextColumns = checked
      ? [...currentColumns, columnId]
      : currentColumns.filter((column) => column !== columnId)

    form.setValue('visibleColumns', nextColumns, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setIsSaving(true)

    try {
      const result = await saveAuftraegeColumnPreferences(values)

      if (!result.success) {
        showBanner({
          message: ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.update_failed,
          variant: 'error',
        })
        return
      }

      form.reset({
        visibleColumns: result.visibleColumns,
      })
      router.refresh()
      showBanner({
        message: 'Deine Aufträge-Spalten wurden gespeichert.',
        variant: 'success',
      })
    } finally {
      setIsSaving(false)
    }
  })

  return (
    <div className="space-y-6 pb-28">
      <Card>
        <CardHeader>
          <CardTitle>Sichtbare Spalten</CardTitle>
          <CardDescription>
            Entscheide pro Organisation selbst, welche Spalten deine Aufträge-Tabelle
            zeigen soll.
          </CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={onSubmit}>
            <CardContent className="space-y-5 pb-8">
              <FormField
                control={form.control}
                name="visibleColumns"
                render={() => (
                  <FormItem>
                    <FormLabel>Tabellenspalten</FormLabel>
                    <FormDescription>
                      Diese Auswahl gilt nur für dich innerhalb von {organizationName}.
                    </FormDescription>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {AUFTRAEGE_TABLE_COLUMNS.map((column) => {
                        const isChecked = form.watch('visibleColumns').includes(column.id)

                        return (
                          <label
                            key={column.id}
                            className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/30"
                          >
                            <FormControl>
                              <Checkbox
                                checked={isChecked}
                                disabled={isSaving}
                                onCheckedChange={(checked) =>
                                  toggleColumn(column.id, checked === true)
                                }
                              />
                            </FormControl>
                            <div>
                              <p className="text-sm font-medium leading-none">
                                {column.label}
                              </p>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex flex-col items-start gap-3 border-t sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Aktionen, Aufklappen und andere strukturelle Bedienelemente bleiben
                weiterhin immer sichtbar.
              </p>
              <Button type="submit" disabled={isSaving || !form.formState.isDirty}>
                {isSaving ? 'Speichert...' : 'Ansicht speichern'}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  )
}
