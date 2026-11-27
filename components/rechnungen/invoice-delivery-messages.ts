import { DELIVERY_REFUSALS } from '@/components/delivery/delivery-messages';

// The German sentences of the invoice delivery actions' refusals
// (lib/invoices/delivery-actions.ts), beside the delivery's own.

export const DELIVERY_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  ...DELIVERY_REFUSALS,
  invoice_not_found: 'Diese Rechnung gibt es nicht mehr.',
  invoice_not_issued: 'Nur eine ausgestellte Rechnung lässt sich versenden.',
  original_missing: 'Das Original der Rechnung ist noch nicht abgelegt. Erstelle zuerst den Beleg.',
  document_not_found: 'Das Original der Rechnung ist nicht mehr verfügbar.',
  delivery_retry_expired:
    'Der Versand ist älter als einen Tag und lässt sich nicht mehr wiederholen. Sende die Rechnung bei Bedarf neu per E-Mail.',
};
