'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { useBanner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Form, FormField } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { InlinePending } from '@/components/ui/inline-pending'
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
  const { showBanner } = useBanner()
  const [isSaving, setIsSaving] = useState(false)
  const canEdit = role === 'admin'
  const {
    breakMode: initialBreakMode,
    autoBreakThresholdMinutes: initialAutoBreakThresholdMinutes,
    autoBreakDurationMinutes: initialAutoBreakDurationMinutes,
  } = initialSettings

  const form = useForm<
    TimeTrackingSettingsFormInput,
    undefined,
    TimeTrackingSettingsFormOutput
  >({
    resolver: zodResolver(timeTrackingSettingsSchema),
    defaultValues: initialSettings,
  })

  const selectedBreakMode = form.watch('breakMode')
  const { reset } = form

  useEffect(() => {
    reset({
      breakMode: initialBreakMode,
      autoBreakThresholdMinutes: initialAutoBreakThresholdMinutes,
      autoBreakDurationMinutes: initialAutoBreakDurationMinutes,
    })
  }, [
    initialAutoBreakDurationMinutes,
    initialAutoBreakThresholdMinutes,
    initialBreakMode,
    reset,
  ])

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
    } catch (error) {
      console.error('Unexpected error saving time-tracking settings:', error)
      showBanner({ message: ERROR_MESSAGES.update_failed, variant: 'error' })
    } finally {
      setIsSaving(false)
    }
  })

  return (
    <div className="space-y-6 pb-28">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Pausenregel
            <InlinePending active={isSaving} label="Zeiterfassungsregeln werden gespeichert" />
          </CardTitle>
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
                render={({ field, fieldState }) => (
                  <Field
                    label="Art der Pausenbuchung"
                    required
                    description={
                      BREAK_MODE_OPTIONS.find((option) => option.value === field.value)
                        ?.description ?? BREAK_MODE_OPTIONS[0].description
                    }
                    error={fieldState.error?.message}
                  >
                    <Select
                      disabled={!canEdit || isSaving}
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Bitte wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {BREAK_MODE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="autoBreakThresholdMinutes"
                  render={({ field, fieldState }) => (
                    <Field
                      label="Automatische Schwelle (Minuten)"
                      required
                      description="Ab dieser gesamten Anwesenheitszeit wird die automatische Pause berücksichtigt."
                      error={fieldState.error?.message}
                    >
                        <Input
                          name={field.name}
                          ref={field.ref}
                          type="text"
                          inputMode="numeric"
                          disabled={!canEdit || isSaving || selectedBreakMode !== 'automatic'}
                          onBlur={field.onBlur}
                          value={typeof field.value === 'number' ? field.value : ''}
                          onChange={(event) =>
                            field.onChange(
                              Number(event.target.value.replace(/[^0-9]/g, '') || 0)
                            )
                          }
                        />
                    </Field>
                  )}
                />

                <FormField
                  control={form.control}
                  name="autoBreakDurationMinutes"
                  render={({ field, fieldState }) => (
                    <Field
                      label="Automatische Pausendauer (Minuten)"
                      description="Diese Minuten werden automatisch abgezogen, sobald die Schwelle erreicht ist."
                      error={fieldState.error?.message}
                    >
                        <Input
                          name={field.name}
                          ref={field.ref}
                          type="text"
                          inputMode="numeric"
                          disabled={!canEdit || isSaving || selectedBreakMode !== 'automatic'}
                          onBlur={field.onBlur}
                          value={typeof field.value === 'number' ? field.value : ''}
                          onChange={(event) =>
                            field.onChange(
                              Number(event.target.value.replace(/[^0-9]/g, '') || 0)
                            )
                          }
                        />
                    </Field>
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
