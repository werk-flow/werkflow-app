// The German sentence of a failed delivery's stored code
// (lib/delivery/send-email.ts, lib/delivery/document-delivery.ts) and the
// step that helps.

import { formatBerlinDateTime } from '@/lib/utils';
import type { DeliveryEntry } from './delivery-types';

// The provider may have taken the mail: it did not answer, or answered
// without a message id.
function outcomeUnknown(code: string | null): boolean {
  return code === 'email_provider_unreachable' || code === 'email_provider_invalid_response';
}

// The provider refused the mail itself, most often its address: sent again,
// the stored mail fails the same way.
function refusedByProvider(code: string | null): boolean {
  return code === 'email_validation_error' || code === 'email_provider_422';
}

// WerkFlow's mail provider was not set up or refused WerkFlow's key.
function notConfigured(code: string | null): boolean {
  return code === 'email_not_configured' || code === 'email_provider_unauthorized';
}

/**
 * Why a delivery failed, from its stored code, without a next step; the code
 * itself never reaches the screen.
 */
function deliveryFailureSentence(code: string | null): string {
  if (notConfigured(code)) return 'Der E-Mail-Versand war nicht eingerichtet.';
  if (outcomeUnknown(code)) {
    return 'Der Mailanbieter hat nicht geantwortet. Ob die E-Mail rausging, ist unklar.';
  }
  if (code === 'attachment_unavailable') return 'Das Original war gerade nicht lesbar.';
  if (code === 'attachment_changed') return 'Das Original stimmt nicht mehr mit dem abgelegten überein.';
  if (refusedByProvider(code)) return 'Der Mailanbieter hat die E-Mail abgelehnt.';
  return 'Die E-Mail ist nicht rausgegangen.';
}

/** What helps after a failure; `retryStep` names the retry where one is offered. */
function nextStep(code: string | null, retryStep: string): string {
  // „Erneut senden“ repeats the stored address.
  if (refusedByProvider(code)) {
    return 'Prüfe die Adresse und sende über „Per E-Mail senden“ eine neue E-Mail an die richtige Adresse.';
  }
  if (notConfigured(code)) return ['Versuche es später erneut.', retryStep].filter(Boolean).join(' ');
  return retryStep;
}

/**
 * What became of a delivery that takes no further step, as on a cancelled
 * invoice: the last attempt's reason, and whether an earlier attempt without
 * the provider's answer may have reached the customer.
 */
export function pastDeliveryOutcome(entry: Pick<DeliveryEntry, 'failureCode' | 'outcomeUnknown'>): string {
  const reason = deliveryFailureSentence(entry.failureCode);
  if (!entry.outcomeUnknown || outcomeUnknown(entry.failureCode)) return reason;
  return `${reason} Ob die E-Mail bei einem früheren Versuch rausging, ist unklar.`;
}

/** Why a delivery failed and what helps. */
export function deliveryFailureAdvice(code: string | null, retryStep = ''): string {
  return [deliveryFailureSentence(code), nextStep(code, retryStep)].filter(Boolean).join(' ');
}

/**
 * The newest email that went out or may have (still sending, or any attempt
 * ended without the provider's answer), so the form warns before a second
 * one; a delivery whose every attempt failed before the provider took the
 * mail never left.
 */
export function priorEmailAdvice(entries: readonly DeliveryEntry[]): string | null {
  const last = entries.find(
    (entry) => entry.channel === 'email' && (entry.state !== 'failed' || entry.outcomeUnknown),
  );
  if (!last) return null;
  if (last.state !== 'sent') {
    return `Ob die E-Mail vom ${formatBerlinDateTime(last.createdAt)} an ${last.recipient ?? ''} rausging, ist unklar. Frag am besten beim Kunden nach, bevor du sie noch einmal sendest.`;
  }
  return `Zuletzt ging sie am ${formatBerlinDateTime(last.sentAt ?? last.createdAt)} an ${last.recipient ?? ''} raus.`;
}
