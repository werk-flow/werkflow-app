import { renderMail, type RenderedMail } from '@/lib/werkflow-billing/mails/layout';

// The mail to WerkFlow's alarm address (werk-flow/werkflow-planning#251). It
// names Stripe ids, WerkFlow ids and codes only; the person looks the rest up
// in Stripe, so no customer name, address or bank detail travels in an alarm.

export type BillingAlarmKind =
  | 'debit_failed'
  | 'debit_reversed'
  | 'mandate_inactive'
  | 'mail_failed'
  | 'invoice_check_failed';

export type BillingAlarmFacts = readonly (readonly [label: string, value: string])[];

const ALARM_COPY: Record<BillingAlarmKind, { title: string; what: string; next: string }> = {
  debit_failed: {
    title: 'Zahlung fehlgeschlagen',
    what: 'Stripe konnte eine WerkFlow-Rechnung nicht einziehen. Der Kunde arbeitet ganz normal weiter.',
    next: 'Prüfe die Rechnung in Stripe und sprich den Kunden an, wenn sie offen bleibt.',
  },
  debit_reversed: {
    title: 'Zahlung zurückgeholt',
    what: 'Ein Kunde oder seine Bank hat eine Zahlung zurückgeholt. Stripe führt das als Dispute.',
    next: 'Reagiere in Stripe auf den Dispute, bevor seine Frist abläuft.',
  },
  mandate_inactive: {
    title: 'Lastschriftmandat ungültig',
    what: 'Das SEPA-Mandat eines Kunden gilt nicht mehr. Die nächste Lastschrift schlägt fehl.',
    next: 'Kläre mit dem Kunden ein neues Mandat oder eine andere Zahlungsart.',
  },
  mail_failed: {
    title: 'Abrechnungsmail abgelehnt',
    what: 'Der Mailversand hat eine Abrechnungsmail an einen Kunden endgültig abgelehnt.',
    next: 'Prüfe die E-Mail-Adresse des Kunden in Stripe und informiere ihn auf einem anderen Weg.',
  },
  invoice_check_failed: {
    title: 'Rechnungsprüfung fehlgeschlagen',
    what: 'Eine Stripe-Rechnung hat die Prüfung nicht bestanden oder die Prüfung war nicht erreichbar. Sie liegt noch nicht als WerkFlow-Original vor.',
    next: 'Prüfe die Rechnung in Stripe. Stripe stellt das Signal erneut zu, bis die Prüfung klappt.',
  },
};

export function renderAlarmMail(kind: BillingAlarmKind, facts: BillingAlarmFacts): RenderedMail {
  const copy = ALARM_COPY[kind];
  return renderMail({
    subject: `WerkFlow-Alarm: ${copy.title}`,
    heading: copy.title,
    paragraphs: [copy.what, copy.next],
    facts,
    footnote: 'Diese Nachricht geht an die Alarmadresse von WerkFlow, nicht an Kunden.',
  });
}
