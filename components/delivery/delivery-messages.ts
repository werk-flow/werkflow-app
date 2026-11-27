// The German sentences of lib/delivery/'s own refusals, shared by every
// sending host; a host adds its subject's codes. A failed delivery's stored
// code takes its sentence from lib/delivery/failure-advice.ts, and shared
// codes take theirs from lib/action-messages.ts.

export const DELIVERY_REFUSALS: Readonly<Record<string, string>> = {
  delivery_not_found: 'Diesen Versand gibt es nicht mehr.',
  delivery_not_retryable: 'Dieser Versand lässt sich nicht erneut senden.',
  rate_limited: 'Gerade wurden sehr viele E-Mails versendet. Versuche es in einer Stunde erneut.',
  send_unavailable: 'Der Versand ist gerade nicht möglich. Versuche es in einem Moment erneut.',
};

/** A refusal past the retry window while an earlier attempt may have reached the customer. */
export const RETRY_EXPIRED_UNCLEAR =
  'Der Versand ist älter als 23 Stunden und lässt sich nicht mehr wiederholen. Ob die E-Mail rausging, ist unklar: Frag beim Kunden nach, ob sie ankam, bevor du eine neue E-Mail sendest.';
