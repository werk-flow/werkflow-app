'use client';

import { describeFailure } from '@/lib/action-messages';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { InlinePending } from '@/components/ui/inline-pending';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useServerAction } from '@/hooks/use-server-action';
import { setHolidayRegion } from '@/lib/org/calendar-actions';
import { HOLIDAY_REGIONS, HOLIDAY_REGION_LABELS, isHolidayRegion } from '@/lib/personnel/holidays';

const REGION_ERROR_MESSAGES = {
  not_authorized: 'Nur der Admin kann den Feiertagskalender ändern.',
  invalid_region: 'Bitte wähle ein gültiges Bundesland aus.',
  org_not_found: 'Die aktive Organisation konnte nicht gefunden werden.',
  update_failed: 'Der Feiertagskalender konnte nicht gespeichert werden.',
} satisfies Record<string, string>;

const NO_REGION_VALUE = 'none';

export function HolidayRegionCard({
  holidayRegion,
  canEditRegion,
}: {
  holidayRegion: string | null;
  canEditRegion: boolean;
}) {
  const router = useRouter();
  const { showBanner } = useBanner();

  const [selectedRegion, setSelectedRegion] = useState<string>(
    holidayRegion && isHolidayRegion(holidayRegion) ? holidayRegion : NO_REGION_VALUE,
  );
  const { run: runSaveRegion, isPending: isSavingRegion } = useServerAction(setHolidayRegion);

  const regionDirty =
    selectedRegion !== (holidayRegion && isHolidayRegion(holidayRegion) ? holidayRegion : NO_REGION_VALUE);

  const handleSaveRegion = async () => {
    if (!canEditRegion || isSavingRegion) return;
    try {
      const result = await runSaveRegion(selectedRegion === NO_REGION_VALUE ? null : selectedRegion);
      if (!result.success) {
        showBanner({
          message: describeFailure(result.error, REGION_ERROR_MESSAGES, REGION_ERROR_MESSAGES.update_failed),
          variant: 'error',
        });
        return;
      }
      router.refresh();
      showBanner({
        message: 'Der Feiertagskalender wurde gespeichert.',
        variant: 'success',
      });
    } catch {
      showBanner({ message: REGION_ERROR_MESSAGES.update_failed, variant: 'error' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Feiertagskalender
          <InlinePending active={isSavingRegion} label="Feiertagskalender wird gespeichert" />
        </CardTitle>
        <CardDescription>
          Wähle das Bundesland, dessen gesetzliche Feiertage für die Sollarbeitszeit gelten. An Feiertagen ist
          die Sollzeit 0.
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
          {isSavingRegion ? 'Speichert…' : 'Feiertagskalender speichern'}
        </Button>
      </CardFooter>
    </Card>
  );
}
