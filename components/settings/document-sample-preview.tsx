'use client';

import { Download, ExternalLink, FileCode, FileText } from 'lucide-react';

import { DocumentSampleRowSkeleton } from '@/components/loading-states/einstellungen-page-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionError } from '@/components/ui/section-error';
import { PdfFrame, usePdfRead } from '@/components/shared/pdf-frame';

/** The route handler that renders the Musterangebot for Admin and Büro. */
const SAMPLE_OFFER_PATH = '/api/musterangebot';

/** The route handler that builds the checked Muster-E-Rechnung (ZUGFeRD PDF with EN 16931 XML) for Admin and Büro. */
const SAMPLE_INVOICE_PATH = '/api/musterrechnung';

type PreviewProps = {
  /** The organization whose profile the sample shows. */
  organizationId: string;
  profileUpdatedAt: string | null;
};

/**
 * The Musterangebot as the PDF a customer receives, shown inline, to open or download. A
 * saved change of the company profile renders it anew; another organization
 * mounts a new preview, so no sample of the one before stays on screen.
 */
export function DocumentSamplePreview(props: PreviewProps) {
  return <SamplePreview key={props.organizationId} profileUpdatedAt={props.profileUpdatedAt} />;
}

function SamplePreview({ profileUpdatedAt }: Pick<PreviewProps, 'profileUpdatedAt'>) {
  const sample = usePdfRead({
    path: SAMPLE_OFFER_PATH,
    deps: [profileUpdatedAt],
    failureMessage: 'Das Musterangebot konnte nicht erstellt werden.',
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Musterangebot</CardTitle>
        <CardDescription>
          So kommt ein Angebot als PDF bei deinen Kunden an: mit deinen Firmenangaben, deinem Logo oder
          Briefpapier, einem erfundenen Kunden und erfundenen Preisen.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sample.failure ? (
          <SectionError failure={sample.failure} />
        ) : sample.data ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <FileText className="size-8 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">Musterangebot.pdf</p>
                <p className="text-sm text-muted-foreground">PDF-Datei, wie dein Kunde sie bekommt</p>
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
          <DocumentSampleRowSkeleton />
        )}
        {!sample.failure && (
          <PdfFrame
            url={sample.data?.url}
            title="Musterangebot"
            loadingLabel="Musterangebot wird erstellt."
          />
        )}
        <div>
          <Button variant="link" className="h-auto px-0" asChild>
            <a href={SAMPLE_INVOICE_PATH} target="_blank" rel="noreferrer">
              <FileCode className="size-4" />
              Muster-E-Rechnung (ZUGFeRD-PDF)
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
