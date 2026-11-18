// The German sentence of each refusal the invoice actions answer
// (lib/invoices/actions.ts, issue-actions.ts, cancel-actions.ts). Shared codes take their sentence from
// lib/action-messages.ts.
export const INVOICE_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  client_not_found: 'Den Kunden gibt es nicht mehr. Wähle einen anderen.',
  client_archived: 'Der Kunde ist archiviert. Stelle ihn zuerst wieder her oder wähle einen anderen.',
  work_not_found: 'Das gewählte Vorhaben gehört nicht zu diesem Kunden. Wähle es neu.',
  invoice_not_found: 'Diese Rechnung gibt es nicht mehr.',
  invoice_not_draft: 'Die Rechnung ist kein Entwurf mehr und lässt sich nicht mehr ändern.',
  stale_version: 'Jemand hat die Rechnung inzwischen geändert. Lade die Seite neu und prüfe die Änderungen.',
  save_failed: 'Die Rechnung konnte nicht gespeichert werden. Bitte versuche es erneut.',
  delete_failed: 'Der Entwurf konnte nicht gelöscht werden. Bitte versuche es erneut.',
  invoice_incomplete: 'Der Rechnung fehlen noch Positionen oder das Leistungsdatum.',
  invoice_not_issued: 'Die Rechnung ist noch ein Entwurf.',
  issue_failed: 'Die Rechnung konnte nicht ausgestellt werden. Bitte versuche es erneut.',
  invoice_cancelled: 'Die Rechnung ist bereits storniert.',
  invoice_is_storno: 'Eine Stornorechnung lässt sich nicht stornieren.',
  invoice_not_cancellable: 'Eine Gutschrift mit negativem Betrag lässt sich nicht stornieren.',
  cancel_failed: 'Die Rechnung konnte nicht storniert werden. Bitte versuche es erneut.',
  original_failed: 'Der Beleg konnte nicht erstellt werden. Bitte versuche es in einem Moment erneut.',
};
