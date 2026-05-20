'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { updateTimeTrackingSettings } from '@/lib/time-tracking/settings-actions'
import {
  BREAK_MODE_OPTIONS,
  timeTrackingSettingsSchema,
  type TimeTrackingSettingsValues,
} from '@/lib/time-tracking/settings'

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Du bist nicht angemeldet.',
  org_not_found: 'Die aktive Organisation konnte nicht gefunden werden.',
  not_authorized: 'Nur Admins können diese Regeln ändern.',
  invalid_input: 'Bitte prüfe die Pausenregeln.',
  no_changes: 'Es wurden keine Änderungen vorgenommen.',
  update_failed: 'Die Zeiterfassungsregeln konnten nicht gespeichert werden.',
}

type TimeTrackingSettingsFormProps = {
  initialSettings: TimeTrackingSettingsValues
  role: 'admin' | 'buero' | 'employee'
}

type TimeTrackingSettingsFormInput = z.input<typeof timeTrackingSettingsSchema>
type TimeTrackingSettingsFormOutput = z.output<typeof timeTrackingSettingsSchema>

export function TimeTrackingSettingsForm({
  initialSettings,
  role,
}: TimeTrackingSettingsFormProps) {
  const router = useRouter()
  const { showBanner } = useSettingsBanner()
  const [isSaving, setIsSaving] = useState(false)
  const canEdit = role === 'admin'

  const form = useForm<
    TimeTrackingSettingsFormInput,
    undefined,
    TimeTrackingSettingsFormOutput
  >({
    resolver: zodResolver(timeTrackingSettingsSchema),
    defaultValues: initialSettings,
  })

  const selectedBreakMode = form.watch('breakMode')

  useEffect(() => {
    form.reset(initialSettings)
  }, [form, initialSettings])

  const onSubmit = form.handleSubmit(async (values) => {
    if (!canEdit) {
      return
    }

    setIsSaving(true)

    try {
      const result = await updateTimeTrackingSettings(values)

      if (!result.success) {
        showBanner({
          message: ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.update_failed,
          variant: 'error',
        })
        return
      }

      form.reset({
        breakMode: result.breakMode,
        autoBreakThresholdMinutes: result.autoBreakThresholdMinutes,
        autoBreakDurationMinutes: result.autoBreakDurationMinutes,
      })
      router.refresh()
      showBanner({
        message: 'Die Regeln für die Zeiterfassung wurden gespeichert.',
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
          <CardTitle>Pausenregel</CardTitle>
          <CardDescription>
            Lege fest, ob Pausen weiter manuell gestempelt werden oder automatisch
            abgezogen werden.
          </CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={onSubmit}>
            <CardContent className="space-y-5 pb-8">
              <FormField
                control={form.control}
                name="breakMode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Art der Pausenbuchung</FormLabel>
                    <Select
                      disabled={!canEdit || isSaving}
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Bitte wählen" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BREAK_MODE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {BREAK_MODE_OPTIONS.find((option) => option.value === field.value)
                        ?.description ?? BREAK_MODE_OPTIONS[0].description}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="autoBreakThresholdMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Automatische Schwelle (Minuten)</FormLabel>
                      <FormControl>
                        <Input
                          name={field.name}
                          ref={field.ref}
                          type="number"
                          disabled={!canEdit || isSaving || selectedBreakMode !== 'automatic'}
                          min={1}
                          max={1440}
                          onBlur={field.onBlur}
                          value={typeof field.value === 'number' ? field.value : ''}
                          onChange={(event) =>
                            field.onChange(Number(event.target.value || 0))
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Ab dieser gesamten Anwesenheitszeit wird die automatische Pause
                        berücksichtigt.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="autoBreakDurationMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Automatische Pausendauer (Minuten)</FormLabel>
                      <FormControl>
                        <Input
                          name={field.name}
                          ref={field.ref}
                          type="number"
                          disabled={!canEdit || isSaving || selectedBreakMode !== 'automatic'}
                          min={0}
                          max={1440}
                          onBlur={field.onBlur}
                          value={typeof field.value === 'number' ? field.value : ''}
                          onChange={(event) =>
                            field.onChange(Number(event.target.value || 0))
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Diese Minuten werden automatisch abgezogen, sobald die Schwelle
                        erreicht ist.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col items-start gap-3 border-t sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {canEdit
                  ? 'Neue Regeln gelten sofort für offene und kommende Zeiterfassungen. Bereits abgeschlossene Historie wird nicht rückwirkend umgeschrieben.'
                  : 'Du kannst diese Regeln einsehen, aber nur der Admin kann sie ändern.'}
              </p>
              <Button
                type="submit"
                disabled={!canEdit || isSaving || !form.formState.isDirty}
              >
                {isSaving ? 'Speichert...' : 'Zeiterfassung speichern'}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  )
}
