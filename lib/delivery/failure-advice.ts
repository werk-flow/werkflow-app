// The German sentence of a failed delivery's stored code
// (lib/delivery/send-email.ts, lib/delivery/document-delivery.ts) and the
// step that helps.

// The provider refused the mail itself, most often its address: sent again,
// the stored mail fails the same way.
function refusedByProvider(code: string | null): boolean {
  return code === 'email_validation_error' || code === 'email_provider_422';
}

/** Why a delivery failed, from its stored code; the code itself never reaches the screen. */
function deliveryFailureSentence(code: string | null): string {
  if (code === 'email_not_configured' || code === 'email_provider_unauthorized') {
    return 'Der E-Mail-Versand ist gerade nicht eingerichtet. Versuche es später erneut.';
  }
  if (code === 'email_provider_unreachable' || code === 'email_provider_invalid_response') {
    return 'Der Mailanbieter hat nicht geantwortet. Ob die E-Mail rausging, ist unklar.';
  }
  if (code === 'attachment_unavailable') return 'Das Original war gerade nicht lesbar.';
  if (code === 'attachment_changed') return 'Das Original stimmt nicht mehr mit dem abgelegten überein.';
  if (refusedByProvider(code)) return 'Der Mailanbieter hat die E-Mail abgelehnt.';
  return 'Die E-Mail ist nicht rausgegangen.';
}

/**
 * Why a delivery failed and what helps: a refused mail needs a new email to a
 * corrected address, since „Erneut senden“ repeats the stored one; any other
 * failure takes `retryStep`, if any.
 */
export function deliveryFailureAdvice(code: string | null, retryStep = ''): string {
  const step = refusedByProvider(code)
    ? 'Prüfe die Adresse und sende über „Per E-Mail senden“ eine neue E-Mail an die richtige Adresse.'
    : retryStep;
  return [deliveryFailureSentence(code), step].filter(Boolean).join(' ');
}
