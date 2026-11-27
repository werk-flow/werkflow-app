'use client';

import type { ReactElement } from 'react';

import { DELIVERY_REFUSALS } from '@/components/delivery/delivery-messages';
import { DocumentDeliveryDialog } from '@/components/delivery/document-delivery-dialog';
import { readInBackground } from '@/lib/data/background-read-client';
import {
  markServiceReportSentManually,
  retryServiceReportDelivery,
  sendServiceReportEmail,
} from '@/lib/service-reports/delivery-actions';

// „Versand“ of a Servicebericht through E2c's delivery: its sends with their
// state, „Erneut senden“ for a failed one, „Per E-Mail senden“ with the
// filed PDF, and „Als manuell versendet markieren“.

const REPORT_DELIVERY_FAILURES: Readonly<Record<string, string>> = {
  ...DELIVERY_REFUSALS,
  service_report_not_found: 'Diesen Servicebericht gibt es nicht mehr. Lade die Seite neu.',
  service_report_stale:
    'Inzwischen gibt es einen neueren Servicebericht dieses Besuchs. Versende den neueren aus der Liste.',
  document_not_found:
    'Die abgelegte Datei des Serviceberichts lässt sich nicht versenden. Erstelle ihn neu, dann kannst du ihn senden.',
  delivery_retry_expired:
    'Der Versand ist älter als einen Tag und lässt sich nicht mehr wiederholen. Sende den Servicebericht bei Bedarf neu per E-Mail.',
};

export function ServiceReportDeliveryDialog({
  reportId,
  visitLabel,
  onClose,
}: {
  reportId: string;
  /** The visit as the list names it, for example „12.11.2037 · WP-0004“. */
  visitLabel: string;
  onClose: () => void;
}): ReactElement {
  return (
    <DocumentDeliveryDialog
      onClose={onClose}
      host={{
        title: 'Servicebericht versenden',
        label: visitLabel,
        documentName: 'Der Servicebericht',
        descriptions: {
          overview: 'Der Bericht hängt als PDF an, genau wie er abgelegt ist.',
          email: 'Der Bericht hängt als PDF an, genau wie er abgelegt ist. Prüfe Empfänger und Text.',
          manual:
            'Für einen Bericht, der per Post oder persönlich rausging. WerkFlow verschickt dabei nichts.',
        },
        empty: {
          title: 'Noch kein Versand.',
          description: 'Sende den Servicebericht per E-Mail oder vermerke, dass er per Post rausging.',
        },
        failures: REPORT_DELIVERY_FAILURES,
        loadFailure: 'Der Versand dieses Serviceberichts konnte nicht geladen werden.',
        read: (signal) => readInBackground('service-report-delivery', { reportId }, signal),
        readKey: [reportId],
      }}
      send={(input) => sendServiceReportEmail({ reportId, ...input })}
      retry={(input) => retryServiceReportDelivery(input)}
      manual={(input) => markServiceReportSentManually({ reportId, ...input })}
    />
  );
}
