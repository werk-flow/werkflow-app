import { describeFailure } from '@/lib/action-messages';
import type { ActionFailure, ActionResult } from '@/lib/action-result';

/**
 * The refusals of each time-account form action (rules, accounts, periods,
 * payroll export) and of the database functions it calls, as stable codes.
 * The last code of each list is the action's catch-all for an unexpected failure.
 */
const FAILURE_CODES = {
  createPolicy: [
    'invalid_input',
    'forbidden',
    'not_authorized',
    'invalid_policy_name',
    'policy_not_found',
    'policy_save_failed',
  ],
  assignPolicy: ['invalid_input', 'forbidden', 'not_authorized', 'assignment_failed'],
  openAccount: [
    'invalid_input',
    'forbidden',
    'not_authorized',
    'employee_not_found',
    'reason_required',
    'open_failed',
  ],
  submitAdjustment: [
    'invalid_input',
    'forbidden',
    'not_authorized',
    'account_not_found',
    'invalid_adjustment',
    'stale_version',
    'adjustment_failed',
  ],
  decideAdjustment: [
    'invalid_input',
    'forbidden',
    'responsibility_load_failed',
    'not_responsible_or_self_approval',
    'request_not_found',
    'request_not_pending',
    'stale_version',
    'reason_required',
    'decision_failed',
  ],
  createMapping: ['forbidden', 'employee_number_required', 'mapping_failed'],
  prepare: [
    'invalid_input',
    'forbidden',
    'responsibility_load_failed',
    'period_closed',
    'stale_source_fingerprint',
    'prepare_failed',
  ],
  decideFinding: [
    'invalid_input',
    'forbidden',
    'responsibility_load_failed',
    'finding_not_found',
    'period_not_found',
    'decision_failed',
  ],
  close: [
    'invalid_input',
    'forbidden',
    'responsibility_load_failed',
    'period_not_found',
    'period_order_conflict',
    'period_open_sessions',
    'period_closed',
    'period_not_ended',
    'period_not_prepared',
    'stale_calculation',
    'close_blocked_finding',
    'approval_required_finding',
    'missing_time_account',
    'close_failed',
  ],
  reopen: [
    'invalid_input',
    'forbidden',
    'period_not_found',
    'period_not_closed',
    'period_order_conflict',
    'reason_required',
    'reopen_failed',
  ],
  generateExport: [
    'invalid_input',
    'forbidden',
    'responsibility_load_failed',
    'period_not_closed',
    'mapping_not_configured',
    'mapping_not_found',
    'missing_employee_mapping',
    'payroll_employee_mapping_missing',
    'missing_code_mapping',
    'load_failed',
    'export_failed',
  ],
  downloadExport: [
    'invalid_input',
    'forbidden',
    'responsibility_load_failed',
    'export_not_ready',
    'load_failed',
    'download_failed',
  ],
} as const;

export type TimeAccountAction = keyof typeof FAILURE_CODES;
export type TimeAccountFailureCode<Action extends TimeAccountAction> = (typeof FAILURE_CODES)[Action][number];

/** The result of a time-account form action: success fields, or one of the action's codes. */
export type TimeAccountActionResult<Action extends TimeAccountAction, Data = object> = ActionResult<
  Data,
  TimeAccountFailureCode<Action>
>;

/** A refused close; an open session names the employees whose time still runs. */
type ClosePeriodFailure = ActionFailure<TimeAccountFailureCode<'close'>> & {
  employeeNames?: readonly string[];
};

export type ClosePeriodResult = { success: true } | ClosePeriodFailure;

type ActionMessages = {
  [Action in TimeAccountAction]: {
    messages: Readonly<Partial<Record<TimeAccountFailureCode<Action>, string>>>;
    fallback: string;
  };
};

const PERIOD_NOT_FOUND = 'Diese Periode gibt es nicht mehr. Lade die Seite neu.';

const STALE_ACCOUNT = 'Das Zeitkonto wurde inzwischen geändert. Lade die Seite neu und prüfe den Saldo.';

// `invalid_input`, `not_authorized`, `period_closed` and `responsibility_load_failed` take the shared
// sentences (lib/action-messages.ts).
const MESSAGES: ActionMessages = {
  createPolicy: {
    messages: {
      forbidden: 'Nur Administratoren können Arbeitszeitregeln ändern.',
      invalid_policy_name: 'Gib der Regel einen Namen.',
      policy_not_found: 'Diese Regel gibt es nicht mehr. Lade die Seite neu.',
    },
    fallback: 'Die Regel konnte nicht gespeichert werden. Versuche es erneut.',
  },
  assignPolicy: {
    messages: { forbidden: 'Nur Administratoren können Regeln zuweisen.' },
    fallback: 'Die Regel konnte nicht zugewiesen werden. Versuche es erneut.',
  },
  openAccount: {
    messages: {
      forbidden: 'Nur Administratoren können Zeitkonten eröffnen.',
      employee_not_found: 'Diese Person gibt es nicht mehr. Lade die Seite neu.',
      reason_required: 'Gib einen Grund für die Eröffnung an.',
    },
    fallback: 'Das Zeitkonto konnte nicht eröffnet werden. Versuche es erneut.',
  },
  submitAdjustment: {
    messages: {
      forbidden: 'Nur Admin und Büro können Korrekturen beantragen.',
      account_not_found: 'Dieses Zeitkonto gibt es nicht mehr. Lade die Seite neu.',
      invalid_adjustment: 'Prüfe Minuten, Datum und Grund der Korrektur.',
      stale_version: STALE_ACCOUNT,
    },
    fallback: 'Der Antrag konnte nicht gespeichert werden. Versuche es erneut.',
  },
  decideAdjustment: {
    messages: {
      forbidden: 'Du darfst diesen Antrag nicht entscheiden.',
      not_responsible_or_self_approval:
        'Du darfst diesen Antrag nicht entscheiden. Eigene Anträge gibt eine andere Person frei.',
      request_not_found: 'Diesen Antrag gibt es nicht mehr. Lade die Seite neu.',
      request_not_pending: 'Dieser Antrag ist bereits entschieden. Lade die Seite neu.',
      stale_version: 'Der Antrag wurde inzwischen geändert. Lade die Seite neu.',
      reason_required: 'Gib einen Entscheidungsgrund an.',
    },
    fallback: 'Die Entscheidung konnte nicht gespeichert werden. Versuche es erneut.',
  },
  createMapping: {
    messages: {
      forbidden: 'Nur Administratoren können die Lohnarten-Zuordnung bestätigen.',
      employee_number_required:
        'Für mindestens eine Person fehlt die Personalnummer. Trage sie unter „Mitarbeiter“ in den Personalien ein.',
    },
    fallback: 'Die Zuordnung konnte nicht gespeichert werden. Versuche es erneut.',
  },
  prepare: {
    messages: {
      forbidden: 'Du darfst keine Periode vorbereiten.',
      stale_source_fingerprint:
        'Während der Vorbereitung haben sich Zeiten geändert. Bereite die Periode erneut vor.',
    },
    fallback: 'Die Periode konnte nicht vorbereitet werden. Versuche es erneut.',
  },
  decideFinding: {
    messages: {
      forbidden: 'Du darfst diesen Prüfhinweis nicht entscheiden.',
      finding_not_found: 'Diesen Prüfhinweis gibt es nicht mehr. Lade die Seite neu.',
      period_not_found: PERIOD_NOT_FOUND,
    },
    fallback: 'Die Entscheidung konnte nicht gespeichert werden. Versuche es erneut.',
  },
  close: {
    messages: {
      forbidden: 'Du darfst diesen Monat nicht abschließen.',
      period_not_found: PERIOD_NOT_FOUND,
      period_order_conflict:
        'Monate werden der Reihe nach abgeschlossen. Schließe zuerst den Vormonat ab, oder öffne den Folgemonat wieder.',
      period_open_sessions:
        'Der Monat kann nicht abgeschlossen werden, solange eine Zeiterfassung läuft. Sie muss zuerst beendet werden.',
      period_not_ended: 'Ein Monat kann erst nach seinem letzten Tag abgeschlossen werden.',
      period_not_prepared: 'Bereite die Periode zuerst vor.',
      stale_calculation:
        'Seit der Vorbereitung haben sich Zeiten geändert. Bereite die Periode neu vor und schließe sie dann ab.',
      close_blocked_finding: 'Blockierende Prüfhinweise müssen zuerst behoben werden.',
      approval_required_finding: 'Offene Freigaben müssen zuerst entschieden werden.',
      missing_time_account: 'Für mindestens eine Person fehlt das Zeitkonto. Eröffne es zuerst.',
    },
    fallback: 'Der Monat konnte nicht abgeschlossen werden. Versuche es erneut.',
  },
  reopen: {
    messages: {
      forbidden: 'Nur Administratoren können einen Monat wieder öffnen.',
      period_not_found: PERIOD_NOT_FOUND,
      period_not_closed: 'Der Monat ist nicht abgeschlossen. Lade die Seite neu.',
      period_order_conflict:
        'Monate werden in umgekehrter Reihenfolge wieder geöffnet. Öffne zuerst den abgeschlossenen Folgemonat.',
      reason_required: 'Gib einen Grund für das Wiederöffnen an.',
    },
    fallback: 'Der Monat konnte nicht wieder geöffnet werden. Versuche es erneut.',
  },
  generateExport: {
    messages: {
      forbidden: 'Du darfst keinen Lohnexport erzeugen.',
      period_not_closed: 'Der Lohnexport ist erst nach dem Abschluss des Monats möglich.',
      mapping_not_configured:
        'Die Lohnarten-Zuordnung fehlt. Ein Admin bestätigt sie unter „Regeln & Export“.',
      mapping_not_found: 'Die Lohnarten-Zuordnung fehlt. Ein Admin bestätigt sie unter „Regeln & Export“.',
      missing_employee_mapping:
        'Für mindestens eine Person fehlt die Personalnummer in der Lohnarten-Zuordnung. Ein Admin bestätigt die Zuordnung neu.',
      payroll_employee_mapping_missing:
        'Für mindestens eine Person fehlt die Personalnummer in der Lohnarten-Zuordnung. Ein Admin bestätigt die Zuordnung neu.',
      missing_code_mapping:
        'In der Lohnarten-Zuordnung fehlt eine Lohnart. Ein Admin bestätigt die Zuordnung neu.',
    },
    fallback: 'Der Lohnexport konnte nicht erzeugt werden. Versuche es erneut.',
  },
  downloadExport: {
    messages: {
      forbidden: 'Du darfst diesen Lohnexport nicht herunterladen.',
      export_not_ready: 'Dieser Lohnexport ist nicht mehr verfügbar. Lade die Seite neu.',
    },
    fallback: 'Der Lohnexport konnte nicht heruntergeladen werden. Versuche es erneut.',
  },
};

/** Accepts only the action's known codes, so an unknown database message never reaches a user. */
export function isTimeAccountFailureCode<Action extends TimeAccountAction>(
  action: Action,
  value: string,
): value is TimeAccountFailureCode<Action> {
  const codes: readonly string[] = FAILURE_CODES[action];
  return codes.includes(value);
}

/** German sentence for a refused period action. */
export function getTimeAccountFailureMessage<Action extends TimeAccountAction>(
  action: Action,
  code: TimeAccountFailureCode<Action>,
): string {
  const { messages, fallback }: ActionMessages[TimeAccountAction] = MESSAGES[action];
  return describeFailure(code, messages, fallback);
}

/** German sentence for a refused close; open sessions name the employees. */
export function getClosePeriodFailureMessage(failure: ClosePeriodFailure): string {
  const names = failure.employeeNames ?? [];
  if (failure.error === 'period_open_sessions' && names.length > 0) {
    const list = new Intl.ListFormat('de', { type: 'conjunction' }).format(names);
    return `Der Monat kann nicht abgeschlossen werden, solange eine Zeiterfassung läuft: ${list}. Die Zeiterfassung muss zuerst beendet oder geklärt werden.`;
  }
  return getTimeAccountFailureMessage('close', failure.error);
}
