import { renderMail, type RenderedMail } from '@/lib/werkflow-billing/mails/layout';

// The mail to WerkFlow's alarm address (werk-flow/werkflow-planning#251). It
// names Stripe ids, WerkFlow ids and codes only; the person looks the rest up
// in Stripe, so no customer name, address or bank detail travels in an alarm.

export type BillingAlarmKind =
  | 'debit_failed'
  | 'debit_reversed'
  | 'mandate_inactive'
  | 'mail_failed'
  | 'invoice_check_failed'
  | 'invoice_undelivered'
  | 'debit_notice_late'
  | 'mail_undelivered'
  | 'signals_quiet'
  | 'reconciliation_missed'
  | 'mail_bounced'
  | 'duplicate_subscription_cancelled'
  | 'refund_failed';

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
  invoice_undelivered: {
    title: 'Rechnung nicht zugestellt',
    what: 'Stripe hat eine Rechnung abgeschlossen, aber WerkFlow hat dazu noch kein Original oder keine Rechnungsmail verschickt.',
    next: 'Prüfe die Rechnung in Stripe und schick sie dem Kunden selbst, wenn sie bis morgen nicht ankommt.',
  },
  debit_notice_late: {
    title: 'Lastschrift zu kurzfristig angekündigt',
    what: 'Zwischen der Ankündigung und der Abbuchung liegen weniger als 2 Tage, oder Stripe nennt kein Abbuchungsdatum.',
    next: 'Prüfe die Lastschrift in Stripe. Häuft sich das, muss die Ankündigung früher raus.',
  },
  mail_undelivered: {
    title: 'Abrechnungsmail weiter nicht zugestellt',
    what: 'Eine Abrechnungsmail oder ein Alarm ging auch beim täglichen Abgleich nicht raus, zum Beispiel weil das Mailkontingent aufgebraucht ist.',
    next: 'Prüfe den Mailversand. Der Abgleich versucht es morgen wieder.',
  },
  signals_quiet: {
    title: 'Stripe-Signale bleiben aus',
    what: 'Stripe hat Ereignisse erzeugt, die WerkFlow nicht empfangen hat.',
    next: 'Prüfe den Webhook-Endpunkt in Stripe und seine Fehlermeldungen.',
  },
  reconciliation_missed: {
    title: 'Täglicher Abgleich ausgefallen',
    what: 'Der tägliche Abgleich mit Stripe ist seit mehr als einem Tag nicht gelaufen.',
    next: 'Prüfe den Cron-Job in Vercel. Dieser Lauf hat den Abgleich nachgeholt.',
  },
  mail_bounced: {
    title: 'Abrechnungsmail kam nicht an',
    what: 'Eine Abrechnungsmail an einen Kunden kam als unzustellbar zurück, oder der Empfänger hat sie als Spam gemeldet.',
    next: 'Prüfe die E-Mail-Adresse des Kunden in Stripe und informiere ihn auf einem anderen Weg.',
  },
  duplicate_subscription_cancelled: {
    title: 'Zweites Abo erstattet und gekündigt',
    what: 'Für eine Organisation lief ein zweites Abo, oder ein Abo für eine gelöschte Organisation oder ein gelöschtes Konto. WerkFlow hat die Zahlungen seiner letzten Rechnung erstattet und es sofort gekündigt.',
    next: 'Prüfe in Stripe, ob die Erstattung durchgeht. Scheitert sie, kommt ein eigener Alarm.',
  },
  refund_failed: {
    title: 'Erstattung fehlgeschlagen',
    what: 'Stripe konnte eine Erstattung nicht ausführen. Das Geld ist noch nicht beim Kunden.',
    next: 'Erstatte den Betrag von Hand, zum Beispiel per Überweisung, und vermerke es in Stripe.',
  },
};

/** Whether a stored kind (without its `alarm.` prefix) is one this code renders. */
export function isBillingAlarmKind(kind: string): kind is BillingAlarmKind {
  return Object.hasOwn(ALARM_COPY, kind);
}

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
