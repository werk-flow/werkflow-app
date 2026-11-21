// The German sentence of each refusal the invoice actions answer
// (lib/invoices/actions.ts). Shared codes take their sentence from
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
};
