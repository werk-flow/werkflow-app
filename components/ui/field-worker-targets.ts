/**
 * The field worker's touch targets (werkflow-design, "Density and layout"):
 * for the employee role the app shell marks its main region with
 * `data-field-worker`, and on a phone every registered target inside it grows
 * to 44 x 44 CSS px. Managers keep their compact density on every screen, and
 * a field worker keeps it from the tablet breakpoint on.
 */

/** A button or a tab: at least 44 x 44 px on a field worker's phone. */
export const FIELD_WORKER_TARGET_CLASS =
  'max-sm:[[data-field-worker]_&]:min-h-11 max-sm:[[data-field-worker]_&]:min-w-11';

/** A tab strip whose tabs grow on a field worker's phone gives up its fixed height. */
export const FIELD_WORKER_TAB_STRIP_CLASS = 'max-sm:[[data-field-worker]_&]:h-auto';

/** The links inside a list row (its title link): at least 44 px tall on a field worker's phone. */
export const FIELD_WORKER_ROW_LINK_CLASS =
  'max-sm:[[data-field-worker]_&_a[href]]:min-h-11 max-sm:[[data-field-worker]_&_a[href]]:min-w-11';
