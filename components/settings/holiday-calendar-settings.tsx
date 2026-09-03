'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2 } from 'lucide-react'

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
import { Input } from '@/components/ui/input'
import { InlinePending } from '@/components/ui/inline-pending'
import { DatePicker } from '@/components/ui/date-picker'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useBusyIds } from '@/hooks/use-busy-id'
import {
  addClosureDay,
  removeClosureDay,
  setHolidayRegion,
} from '@/lib/org/calendar-actions'
import {
  HOLIDAY_REGIONS,
  HOLIDAY_REGION_LABELS,
  isHolidayRegion,
} from '@/lib/personnel/holidays'
import type { ClosureDay } from '@/lib/personnel/targets'
import { toLocalDateString } from '@/lib/utils'

const REGION_ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'Nur der Admin kann den Feiertagskalender ändern.',
  invalid_region: 'Bitte wähle ein gültiges Bundesland aus.',
  org_not_found: 'Die aktive Organisation konnte nicht gefunden werden.',
  update_failed: 'Der Feiertagskalender konnte nicht gespeichert werden.',
}

const CLOSURE_ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'Du bist nicht berechtigt, Betriebsruhe-Tage zu ändern.',
  invalid_date: 'Bitte gib ein gültiges Datum an.',
  date_in_past:
    'Vergangene Tage können nicht geändert werden – frühere Zeiträume behalten ihre damalige Bedeutung.',
  duplicate_date: 'Für dieses Datum ist bereits Betriebsruhe eingetragen.',
  closure_day_not_found: 'Der Betriebsruhe-Tag wurde nicht gefunden.',
  create_failed: 'Der Betriebsruhe-Tag konnte nicht gespeichert werden.',
  delete_failed: 'Der Betriebsruhe-Tag konnte nicht entfernt werden.',
}

const NO_REGION_VALUE = 'none'

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

type HolidayCalendarSettingsProps = {
  holidayRegion: string | null
  closureDays: ClosureDay[]
  role: 'admin' | 'buero' | 'employee'
}

export function HolidayCalendarSettings({
  holidayRegion,
  closureDays,
  role,
}: HolidayCalendarSettingsProps) {
  const router = useRouter()
  const { showBanner } = useBanner()

  const canEditRegion = role === 'admin'
  const canEditClosureDays = role === 'admin' || role === 'buero'

  const [selectedRegion, setSelectedRegion] = useState<string>(
    holidayRegion && isHolidayRegion(holidayRegion)
      ? holidayRegion
      : NO_REGION_VALUE
  )
  const [isSavingRegion, setIsSavingRegion] = useState(false)

  const [closureDate, setClosureDate] = useState<string>('')
  const [closureLabel, setClosureLabel] = useState<string>('')
  const [isAddingClosure, setIsAddingClosure] = useState(false)
  const [closureDateError, setClosureDateError] = useState<string | null>(null)
  const removingClosure = useBusyIds()

  const todayIso = toLocalDateString(new Date())
  const regionDirty =
    selectedRegion !== (holidayRegion && isHolidayRegion(holidayRegion) ? holidayRegion : NO_REGION_VALUE)

  const handleSaveRegion = async () => {
    if (!canEditRegion || isSavingRegion) return
    setIsSavingRegion(true)
    try {
      const result = await setHolidayRegion(
        selectedRegion === NO_REGION_VALUE ? null : selectedRegion
      )
      if (!result.success) {
        showBanner({
          message:
            REGION_ERROR_MESSAGES[result.error] ??
            REGION_ERROR_MESSAGES.update_failed,
          variant: 'error',
        })
        return
      }
      router.refresh()
      showBanner({
        message: 'Der Feiertagskalender wurde gespeichert.',
        variant: 'success',
      })
    } catch (error) {
      console.error('Unexpected error saving the holiday region:', error)
      showBanner({ message: REGION_ERROR_MESSAGES.update_failed, variant: 'error' })
    } finally {
      setIsSavingRegion(false)
    }
  }

  const handleAddClosureDay = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEditClosureDays || isAddingClosure) return
    if (!closureDate) {
      setClosureDateError(CLOSURE_ERROR_MESSAGES.invalid_date)
      document.getElementById('closure-date')?.focus()
      return
    }
    setIsAddingClosure(true)
    try {
      const result = await addClosureDay({
        closureDate,
        label: closureLabel,
      })
      if (!result.success) {
        showBanner({
          message:
            CLOSURE_ERROR_MESSAGES[result.error] ??
            CLOSURE_ERROR_MESSAGES.create_failed,
          variant: 'error',
        })
        return
      }
      setClosureDate('')
      setClosureLabel('')
      router.refresh()
      showBanner({
        message: 'Der Betriebsruhe-Tag wurde eingetragen.',
        variant: 'success',
      })
    } catch (error) {
      console.error('Unexpected error adding a closure day:', error)
      showBanner({ message: CLOSURE_ERROR_MESSAGES.create_failed, variant: 'error' })
    } finally {
      setIsAddingClosure(false)
    }
  }

  const handleRemoveClosureDay = async (closureDayId: string) => {
    if (!canEditClosureDays || removingClosure.isBusy(closureDayId)) return
    await removingClosure.run(closureDayId, async () => {
      const result = await removeClosureDay(closureDayId)
      if (!result.success) {
        showBanner({
          message:
            CLOSURE_ERROR_MESSAGES[result.error] ??
            CLOSURE_ERROR_MESSAGES.delete_failed,
          variant: 'error',
        })
        return
      }
      router.refresh()
      showBanner({
        message: 'Der Betriebsruhe-Tag wurde entfernt.',
        variant: 'success',
      })
    }).catch((error: unknown) => {
      console.error('Unexpected error removing a closure day:', error)
      showBanner({ message: CLOSURE_ERROR_MESSAGES.delete_failed, variant: 'error' })
    })
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Feiertagskalender
            <InlinePending active={isSavingRegion} label="Feiertagskalender wird gespeichert" />
          </CardTitle>
          <CardDescription>
            Wähle das Bundesland, dessen gesetzliche Feiertage für die
            Sollarbeitszeit gelten. An Feiertagen ist die Sollzeit 0.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pb-6">
          <Field
            label="Bundesland"
            htmlFor="holiday-region"
            className="sm:max-w-sm"
            description="Die Auswahl gilt ab jetzt; frühere Zeiträume werden nicht rückwirkend geändert. WerkFlow zeigt die Wirkung des gewählten Kalenders, ersetzt aber keine rechtliche Prüfung."
          >
            <SearchableSelect
              disabled={!canEditRegion || isSavingRegion}
              options={[
                { value: NO_REGION_VALUE, label: 'Kein Feiertagskalender' },
                ...HOLIDAY_REGIONS.map((region) => ({
                  value: region,
                  label: HOLIDAY_REGION_LABELS[region],
                })),
              ]}
              value={selectedRegion}
              onChange={setSelectedRegion}
              placeholder="Bitte wählen"
              searchPlaceholder="Bundesland suchen …"
              emptyMessage="Kein Bundesland gefunden"
            />
          </Field>
        </CardContent>
        <CardFooter className="flex flex-col items-start gap-3 border-t sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {canEditRegion
              ? 'Änderungen gelten ab dem Zeitpunkt der Speicherung.'
              : 'Du kannst den Feiertagskalender einsehen, aber nur der Admin kann ihn ändern.'}
          </p>
          <Button
            type="button"
            onClick={handleSaveRegion}
            disabled={!canEditRegion || isSavingRegion || !regionDirty}
          >
            {isSavingRegion ? 'Speichert...' : 'Feiertagskalender speichern'}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Betriebsruhe</CardTitle>
          <CardDescription>
            Trage betriebsfreie Tage ein (z. B. Betriebsferien oder
            Brückentage). An diesen Tagen ist die Sollarbeitszeit 0. Vergangene
            Tage können nicht geändert werden.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pb-6">
          {closureDays.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine Betriebsruhe-Tage eingetragen.
            </p>
          ) : (
            <ul className="grid gap-2">
              {closureDays.map((day) => {
                const isPast = day.closureDate < todayIso
                return (
                  <li
                    key={day.id ?? day.closureDate}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {formatDate(day.closureDate)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {day.label ?? 'Betriebsruhe'}
                        {isPast ? ' · vergangen' : ''}
                      </p>
                    </div>
                    {canEditClosureDays && !isPast && day.id && (
                      <div className="flex items-center gap-2">
                        <InlinePending active={removingClosure.isBusy(day.id)} label="Betriebsruhe-Tag wird entfernt" />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 text-destructive hover:text-destructive"
                          aria-label={`Betriebsruhe am ${formatDate(day.closureDate)} entfernen`}
                          disabled={removingClosure.isBusy(day.id)}
                          onClick={() => handleRemoveClosureDay(day.id!)}
                        >
                          {removingClosure.isBusy(day.id) ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {canEditClosureDays && (
            <form
              onSubmit={handleAddClosureDay}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <Field
                label="Datum"
                htmlFor="closure-date"
                required
                error={closureDateError}
              >
                <DatePicker
                  ariaLabel="Datum der Betriebsruhe"
                  value={
                    closureDate ? new Date(`${closureDate}T00:00:00`) : undefined
                  }
                  onChange={(date) => {
                    setClosureDateError(null)
                    setClosureDate(date ? toLocalDateString(date) : '')
                  }}
                  disabled={isAddingClosure}
                />
              </Field>
              <Field
                label="Bezeichnung (optional)"
                htmlFor="closure-label"
                className="flex-1"
              >
                <Input
                  placeholder="z. B. Betriebsferien"
                  value={closureLabel}
                  onChange={(e) => setClosureLabel(e.target.value)}
                  disabled={isAddingClosure}
                />
              </Field>
              <Button
                type="submit"
                variant="outline"
                className="gap-1.5"
                disabled={isAddingClosure}
              >
                {isAddingClosure ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Eintragen
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </>
  )
}
