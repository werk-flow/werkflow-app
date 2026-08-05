'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2 } from 'lucide-react'

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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  const { showBanner } = useSettingsBanner()

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
  const [removingClosureId, setRemovingClosureId] = useState<string | null>(null)

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
    } finally {
      setIsSavingRegion(false)
    }
  }

  const handleAddClosureDay = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEditClosureDays || isAddingClosure || !closureDate) return
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
    } finally {
      setIsAddingClosure(false)
    }
  }

  const handleRemoveClosureDay = async (closureDayId: string) => {
    if (!canEditClosureDays || removingClosureId) return
    setRemovingClosureId(closureDayId)
    try {
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
    } finally {
      setRemovingClosureId(null)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Feiertagskalender</CardTitle>
          <CardDescription>
            Wähle das Bundesland, dessen gesetzliche Feiertage für die
            Sollarbeitszeit gelten. An Feiertagen ist die Sollzeit 0.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pb-6">
          <div className="grid gap-2 sm:max-w-sm">
            <Label htmlFor="holiday-region">Bundesland</Label>
            <Select
              disabled={!canEditRegion || isSavingRegion}
              value={selectedRegion}
              onValueChange={setSelectedRegion}
            >
              <SelectTrigger id="holiday-region">
                <SelectValue placeholder="Bitte wählen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_REGION_VALUE}>
                  Kein Feiertagskalender
                </SelectItem>
                {HOLIDAY_REGIONS.map((region) => (
                  <SelectItem key={region} value={region}>
                    {HOLIDAY_REGION_LABELS[region]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Die Auswahl gilt ab jetzt; frühere Zeiträume werden nicht
            rückwirkend geändert. WerkFlow zeigt die Wirkung des gewählten
            Kalenders, ersetzt aber keine rechtliche Prüfung.
          </p>
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-destructive hover:text-destructive"
                        aria-label={`Betriebsruhe am ${formatDate(day.closureDate)} entfernen`}
                        disabled={removingClosureId !== null}
                        onClick={() => handleRemoveClosureDay(day.id!)}
                      >
                        {removingClosureId === day.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
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
              <div className="grid gap-2">
                <Label htmlFor="closure-date">Datum</Label>
                <DatePicker
                  id="closure-date"
                  ariaLabel="Datum der Betriebsruhe"
                  value={
                    closureDate ? new Date(`${closureDate}T00:00:00`) : undefined
                  }
                  onChange={(date) =>
                    setClosureDate(date ? toLocalDateString(date) : '')
                  }
                  disabled={isAddingClosure}
                />
              </div>
              <div className="grid flex-1 gap-2">
                <Label htmlFor="closure-label">Bezeichnung (optional)</Label>
                <Input
                  id="closure-label"
                  placeholder="z. B. Betriebsferien"
                  value={closureLabel}
                  onChange={(e) => setClosureLabel(e.target.value)}
                  disabled={isAddingClosure}
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                className="gap-1.5"
                disabled={isAddingClosure || !closureDate}
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
