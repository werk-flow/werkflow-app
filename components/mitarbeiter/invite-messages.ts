/**
 * Invite-owned failure sentences for `describeFailure`. The shared codes
 * (`SHARED_FAILURE_CODES`) get their sentence from lib/action-messages.ts.
 */
export const SEND_INVITE_MESSAGES: Readonly<Record<string, string>> = {
  org_not_found: 'Organisation nicht gefunden.',
  invalid_email: 'Bitte gib eine gültige E-Mail-Adresse ein.',
  invalid_role: 'Ungültige Rolle ausgewählt.',
  already_member: 'Diese Person ist bereits Mitglied dieser Organisation.',
  invite_already_pending: 'Es gibt bereits eine ausstehende Einladung für diese E-Mail-Adresse.',
  insert_failed: 'Fehler beim Erstellen der Einladung.',
  email_send_failed: 'Fehler beim Senden der Einladungs-E-Mail.',
  too_many_attempts: 'Zu viele Einladungen in kurzer Zeit. Bitte versuche es später erneut.',
  load_failed: 'Die E-Mail-Adresse konnte gerade nicht geprüft werden. Bitte versuche es erneut.',
};

/** Codes of `cancelInvite` and `deleteInvite`. */
export const MANAGE_INVITE_MESSAGES: Readonly<Record<string, string>> = {
  invite_not_found: 'Die Einladung wurde nicht gefunden.',
  already_cancelled: 'Die Einladung wurde bereits storniert.',
  already_accepted: 'Die Einladung wurde bereits angenommen.',
  already_expired: 'Die Einladung ist bereits abgelaufen.',
  invite_not_pending: 'Die Einladung ist nicht mehr offen.',
  cancel_failed: 'Die Einladung konnte nicht storniert werden. Bitte versuche es erneut.',
  must_cancel_first: 'Storniere die Einladung, bevor du sie löschst.',
  delete_failed: 'Die Einladung konnte nicht gelöscht werden. Bitte versuche es erneut.',
};
