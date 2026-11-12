'use client';

import { useEffect } from 'react';
import { Download, ExternalLink, FileText } from 'lucide-react';

import { DocumentSampleRowSkeleton } from '@/components/loading-states/einstellungen-page-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionError } from '@/components/ui/section-error';
import { useClientRead } from '@/hooks/use-client-read';
import type { ActionFailure } from '@/lib/action-result';
import { formatFileSize } from '@/lib/documents/format';

/** The route handler that renders the Musterangebot for Admin and Büro. */
const SAMPLE_OFFER_PATH = '/api/musterangebot';

type SampleOfferRead = { success: true; url: string; sizeBytes: number } | ActionFailure<'load_failed'>;

/** Renders the Musterangebot once and keeps its bytes, so opening and downloading show the same file. */
async function readSampleOffer(signal: AbortSignal): Promise<SampleOfferRead> {
  try {
    const response = await fetch(SAMPLE_OFFER_PATH, { signal, cache: 'no-store' });
    if (!response.ok) return { success: false, error: 'load_failed' };
    const file = await response.blob();
    return { success: true, url: URL.createObjectURL(file), sizeBytes: file.size };
  } catch {
    // A lost connection is the same failure as a refused render: the retry asks again.
    return { success: false, error: 'load_failed' };
  }
}

/** The Musterangebot as the PDF a customer receives, to open or download. */
export function DocumentSamplePreview() {
  const sample = useClientRead({
    read: readSampleOffer,
    deps: [],
    failureMessage: 'Das Musterangebot konnte nicht erstellt werden.',
  });
  const url = sample.data?.url;
  useEffect(() => (url ? () => URL.revokeObjectURL(url) : undefined), [url]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Musterangebot</CardTitle>
        <CardDescription>
          So kommt ein Angebot als PDF bei deinen Kunden an: dein Firmenname als Absender, ein erfundener
          Kunde und erfundene Preise.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sample.failure ? (
          <SectionError failure={sample.failure} />
        ) : sample.data ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <FileText className="size-8 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">Musterangebot.pdf</p>
                <p className="text-sm text-muted-foreground">PDF · {formatFileSize(sample.data.sizeBytes)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <a href={sample.data.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" />
                  Öffnen
                </a>
              </Button>
              <Button asChild>
                <a href={sample.data.url} download="Musterangebot.pdf">
                  <Download className="size-4" />
                  Herunterladen
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <div role="status" aria-busy="true">
            <span className="sr-only">Musterangebot wird erstellt.</span>
            <DocumentSampleRowSkeleton />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
