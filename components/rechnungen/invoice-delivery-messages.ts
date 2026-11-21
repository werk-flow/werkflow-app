// The German sentences of the delivery actions' refusals
// (lib/invoices/delivery-actions.ts) and of a failed delivery's stored code
// (lib/delivery/send-email.ts, lib/delivery/document-delivery.ts). Shared
// codes take their sentence from lib/action-messages.ts.

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

/** Why a delivery failed, from its stored code; the code itself never reaches the screen. */
export function deliveryFailureSentence(code: string | null): string {
  if (code === 'email_not_configured' || code === 'email_provider_unauthorized') {
    return 'Der E-Mail-Versand ist gerade nicht eingerichtet. Versuche es später erneut.';
  }
  if (code === 'email_provider_unreachable' || code === 'email_provider_invalid_response') {
    return 'Der Mailanbieter hat nicht geantwortet. Ob die E-Mail rausging, ist unklar.';
  }
  if (code === 'attachment_unavailable') return 'Das Original war gerade nicht lesbar.';
  if (code === 'attachment_changed') return 'Das Original stimmt nicht mehr mit dem abgelegten überein.';
  if (code === 'email_validation_error' || code === 'email_provider_422') {
    return 'Der Mailanbieter hat die E-Mail abgelehnt. Prüfe die Adresse und sende sie bei Bedarf neu.';
  }
  return 'Die E-Mail ist nicht rausgegangen.';
}
