// The replacement's own limit and failure copy. Only the replace dialog and the
// correction on the detail page read them; the equipment register's shared
// copy stays in types.ts, which every route's Anlagen skeleton loads.

/** The most running plans one replacement carries; replace_installed_equipment refuses an Anlage with more. */
export const REPLACEMENT_PLAN_LIMIT = 50;

/** Why an Anlage with more running plans than one replacement carries cannot be replaced. */
export const REPLACEMENT_TOO_MANY_PLANS_MESSAGE = `Diese Anlage hat mehr als ${REPLACEMENT_PLAN_LIMIT} laufende Wartungspläne. So viele kann ein Austausch nicht auf einmal übernehmen. Beende zuerst die Pläne, die nicht mehr gebraucht werden, dann kannst du die Anlage ersetzen.`;

const REPLACEMENT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  installed_equipment_replacement_duplicate_visit:
    'Ein Wartungsplan hat zwei Besuche für dieselbe Fälligkeit. Schließe zuerst einen davon ab, dann kannst du die Anlage ersetzen.',
  installed_equipment_replacement_plan_scope_changed:
    'Ein Wartungsplan hat noch offene Fälligkeiten aus einer älteren Fassung, die andere Anlagen umfasst als die aktuelle. Schließe diese Fälligkeiten zuerst ab, oder lass den Plan beim Vorgänger.',
  installed_equipment_replacement_plan_reason_required:
    'Bitte begründe, warum der Wartungsplan beim Vorgänger bleibt.',
  installed_equipment_replacement_too_many_plans: REPLACEMENT_TOO_MANY_PLANS_MESSAGE,
  maintenance_template_version_unavailable:
    'Die Arbeitsvorlage eines Wartungsplans ist nicht mehr veröffentlicht. Lass den Plan beim Vorgänger oder überarbeite ihn zuerst.',
};

/** The message of a failure only a replacement or its correction raises; undefined for any other code. */
export function replacementErrorMessage(error: string | undefined): string | undefined {
  return error ? REPLACEMENT_ERROR_MESSAGES[error] : undefined;
}
