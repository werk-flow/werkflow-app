// The German sentences of the delivery actions' refusals
// (lib/invoices/delivery-actions.ts); a failed delivery's stored code takes
// its sentence from lib/delivery/failure-advice.ts. Shared codes take their
// sentence from lib/action-messages.ts.

export const DELIVERY_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  invoice_not_found: 'Diese Rechnung gibt es nicht mehr.',
  invoice_not_issued: 'Nur eine ausgestellte Rechnung lässt sich versenden.',
  original_missing: 'Das Original der Rechnung ist noch nicht abgelegt. Erstelle zuerst den Beleg.',
  document_not_found: 'Das Original der Rechnung ist nicht mehr verfügbar.',
  delivery_not_found: 'Diesen Versand gibt es nicht mehr.',
  delivery_not_retryable: 'Dieser Versand lässt sich nicht erneut senden.',
  delivery_retry_expired:
    'Der Versand ist älter als einen Tag und lässt sich nicht mehr wiederholen. Sende die Rechnung bei Bedarf neu per E-Mail.',
  rate_limited: 'Gerade wurden sehr viele E-Mails versendet. Versuche es in einer Stunde erneut.',
  send_unavailable: 'Der Versand ist gerade nicht möglich. Versuche es in einem Moment erneut.',
};
