'use client';

import type { FormEvent } from 'react';
import { Archive } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import type { OrganizationExportView } from '@/lib/org-export/view';
import { OrganizationExportCard } from './organization-export-card';
import { useExportBuilder } from './use-export-builder';

function StartExportCard({
  onStart,
  isPending,
  error,
}: {
  onStart: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onStart();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Organisation exportieren</CardTitle>
        <CardDescription>
          Lade alle Daten deiner Organisation herunter: jeden Datensatz als Tabelle für Excel, ein Verzeichnis
          aller Dokumente und jede Originaldatei mit allen Versionen, auch die Personalakten.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Große Organisationen erhalten den Export in mehreren Teilen. Lade jeden Teil herunter.</li>
          <li>
            Bleib auf dieser Seite, bis alle Teile fertig sind. Ein fehlender Teil lässt sich hier nachholen.
          </li>
          <li>Jeder Teil lässt sich 7 Tage lang herunterladen. Danach löscht WerkFlow ihn.</li>
        </ul>
        <form onSubmit={handleSubmit} className="space-y-2">
          <Button type="submit" disabled={isPending} aria-busy={isPending || undefined}>
            <InlinePending active={isPending} label="Export wird erstellt" />
            Export starten
          </Button>
          <ErrorText>{error}</ErrorText>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * The Admin's organization export: start an export, then build its parts one
 * request each while the page stays open, and download each part.
 */
export function OrganizationExportSection({ exports }: { exports: OrganizationExportView[] }) {
  const builder = useExportBuilder();
  return (
    <div className="space-y-6">
      <StartExportCard onStart={builder.start} isPending={builder.isRunning} error={builder.startRefusal} />
      {exports.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="Noch keine Exporte"
          description="Starte einen Export, um alle Daten deiner Organisation herunterzuladen."
        />
      ) : (
        exports.map((organizationExport) => (
          <OrganizationExportCard
            key={organizationExport.id}
            organizationExport={organizationExport}
            isBuilding={builder.isBuilding}
            buildDisabled={builder.isRunning}
            partRefusals={builder.partRefusals}
            onBuild={builder.build}
          />
        ))
      )}
    </div>
  );
}
