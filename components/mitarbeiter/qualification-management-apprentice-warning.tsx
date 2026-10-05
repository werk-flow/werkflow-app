'use client';

import type { useBusyIds } from '@/hooks/use-busy-id';
import { useBanner } from '@/components/ui/banner';
import { Checkbox } from '@/components/ui/checkbox';
import { setApprenticeWarningEnabled } from '@/lib/qualifications/actions';

type QualificationManagementApprenticeWarningProps = {
  apprenticeWarningEnabled: boolean;
  isAdmin: boolean;
  anyBusy: boolean;
  runAction: ReturnType<typeof useBusyIds>['run'];
  refresh: () => void;
};

export function QualificationManagementApprenticeWarning({
  apprenticeWarningEnabled,
  isAdmin,
  anyBusy,
  runAction,
  refresh,
}: QualificationManagementApprenticeWarningProps) {
  const { showBanner } = useBanner();

  return (
    <section className="flex items-center justify-between gap-4 rounded-lg border p-4">
      <div>
        <h2 className="text-sm font-semibold">Ausbildungs-Hinweis</h2>
        <p className="text-sm text-muted-foreground">
          Warnt, wenn eine Auswahl nur aus Personen mit Beschäftigungsart „Ausbildung“ besteht oder Angaben
          fehlen. Keine Quote, kein Block.
        </p>
      </div>
      <Checkbox
        checked={apprenticeWarningEnabled}
        disabled={!isAdmin || anyBusy}
        aria-label="Ausbildungs-Hinweis aktivieren"
        onCheckedChange={async (checked) => {
          const enabled = checked === true;
          await runAction('apprentice-warning', async () => {
            try {
              const result = await setApprenticeWarningEnabled(enabled);
              if (!result.success) {
                showBanner({
                  variant: 'error',
                  message: 'Die Einstellung konnte nicht gespeichert werden.',
                });
                return;
              }
              showBanner({
                variant: 'success',
                message: 'Einstellung gespeichert.',
              });
              refresh();
            } catch {
              showBanner({
                variant: 'error',
                message: 'Die Einstellung konnte nicht gespeichert werden.',
              });
            }
          });
        }}
      />
    </section>
  );
}
