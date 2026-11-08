'use client';

import { useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import { useBusyIds } from '@/hooks/use-busy-id';
import { describeFailure } from '@/lib/action-messages';
import { formatFileSize } from '@/lib/documents/format';
import { loadDocument } from '@/lib/navigation/document-load';
import { downloadOrganizationExportPart } from '@/lib/org-export/actions';
import { ORGANIZATION_EXPORT_MESSAGES } from '@/lib/org-export/messages';
import {
  isBuildable,
  type OrganizationExportPartView,
  type OrganizationExportView,
  type PartState,
} from '@/lib/org-export/view';
import { formatBerlinDateTime, formatGermanDate } from '@/lib/utils';

const DOWNLOAD_FAILED = 'Der Download konnte nicht vorbereitet werden. Versuche es erneut.';
const count = new Intl.NumberFormat('de-DE');

function stateBadge(part: OrganizationExportPartView, building: boolean) {
  const state: PartState | 'building' = building ? 'building' : part.state;
  switch (state) {
    case 'ready':
      return (
        <Badge variant="success">Bereit bis {part.expiresAt ? formatGermanDate(part.expiresAt) : ''}</Badge>
      );
    case 'building':
      return <Badge>Wird erstellt</Badge>;
    case 'failed':
      return <Badge variant="destructive">Fehlgeschlagen</Badge>;
    case 'expired':
      return <Badge variant="outline">Gelöscht</Badge>;
    case 'pending':
      return <Badge variant="outline">Ausstehend</Badge>;
  }
}

function partTitle(part: OrganizationExportPartView): string {
  if (part.kind === 'data') return `Teil ${part.partNumber}: Daten und Dokumentenverzeichnis`;
  const files = part.fileCount === 1 ? '1 Datei' : `${count.format(part.fileCount)} Dateien`;
  return `Teil ${part.partNumber}: ${files}, ${formatFileSize(part.fileBytes)}`;
}

function failureText(part: OrganizationExportPartView): string | null {
  if (part.state !== 'failed') return null;
  return describeFailure(
    part.failureReason ?? 'build_failed',
    ORGANIZATION_EXPORT_MESSAGES,
    'Der Teil konnte nicht erstellt werden.',
  );
}

function PartAction({
  part,
  building,
  downloading,
  buildDisabled,
  onDownload,
  onBuild,
}: {
  part: OrganizationExportPartView;
  building: boolean;
  downloading: boolean;
  buildDisabled: boolean;
  onDownload: () => void;
  onBuild: () => void;
}) {
  if (building) return null;
  if (part.state === 'ready')
    return (
      <Button type="button" variant="outline" size="sm" pending={downloading} onClick={onDownload}>
        Herunterladen
      </Button>
    );
  if (part.state === 'failed')
    return (
      <Button type="button" variant="outline" size="sm" disabled={buildDisabled} onClick={onBuild}>
        Erneut versuchen
      </Button>
    );
  return null;
}

function PartRow({
  part,
  building,
  error,
  action,
}: {
  part: OrganizationExportPartView;
  building: boolean;
  error: string | null;
  action: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">{partTitle(part)}</p>
        <div className="flex items-center gap-2">
          {stateBadge(part, building)}
          <InlinePending active={building} label={`Teil ${part.partNumber} wird erstellt`} />
        </div>
        <ErrorText>{building ? null : error}</ErrorText>
      </div>
      {action}
    </li>
  );
}

/** Downloads a ready part through a signed URL; a refusal stays on its row. */
function usePartDownload() {
  const downloads = useBusyIds();
  const [refusals, setRefusals] = useState<ReadonlyMap<string, string>>(new Map());
  const download = async (partId: string) => {
    setRefusals((current) => new Map([...current].filter(([id]) => id !== partId)));
    const result = await downloads
      .run(partId, () => downloadOrganizationExportPart(partId))
      .catch(() => ({ success: false, error: 'export_download_failed' }) as const);
    if (result.success) {
      loadDocument(result.url);
      return;
    }
    const message = describeFailure(result.error, ORGANIZATION_EXPORT_MESSAGES, DOWNLOAD_FAILED);
    setRefusals((current) => new Map(current).set(partId, message));
  };
  return { download, isDownloading: downloads.isBusy, refusals };
}

/** One export with the state, download and retry of each part. */
export function OrganizationExportCard({
  organizationExport,
  isBuilding,
  buildDisabled,
  partRefusals,
  onBuild,
}: {
  organizationExport: OrganizationExportView;
  isBuilding: (partId: string) => boolean;
  buildDisabled: boolean;
  partRefusals: ReadonlyMap<string, string>;
  onBuild: (partIds: readonly string[]) => void;
}) {
  const { download, isDownloading, refusals } = usePartDownload();
  const { parts } = organizationExport;
  const readyCount = parts.filter((part) => part.state === 'ready').length;
  const missing = parts.filter((part) => isBuildable(part) && !isBuilding(part.id));
  const files =
    organizationExport.fileCount === 1 ? '1 Datei' : `${count.format(organizationExport.fileCount)} Dateien`;

  return (
    <Card data-testid="organization-export">
      <CardHeader>
        <CardTitle>Export vom {formatBerlinDateTime(organizationExport.requestedAt)}</CardTitle>
        <CardDescription>
          {files}, {formatFileSize(organizationExport.fileBytes)} · {readyCount} von {parts.length} Teilen
          fertig
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y rounded-lg border">
          {parts.map((part) => (
            <PartRow
              key={part.id}
              part={part}
              building={isBuilding(part.id)}
              error={partRefusals.get(part.id) ?? refusals.get(part.id) ?? failureText(part)}
              action={
                <PartAction
                  part={part}
                  building={isBuilding(part.id)}
                  downloading={isDownloading(part.id)}
                  buildDisabled={buildDisabled}
                  onDownload={() => void download(part.id)}
                  onBuild={() => onBuild([part.id])}
                />
              }
            />
          ))}
        </ul>
        {missing.length > 0 && !buildDisabled ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {missing.length === 1 ? 'Ein Teil fehlt noch.' : `${missing.length} Teile fehlen noch.`}
            </p>
            <Button type="button" onClick={() => onBuild(missing.map((part) => part.id))}>
              Fehlende Teile erstellen
            </Button>
          </div>
        ) : null}
        {parts.some((part) => part.state === 'expired') ? (
          <p className="text-sm text-muted-foreground">
            Gelöschte Teile lassen sich nicht mehr herunterladen. Starte dafür einen neuen Export.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
