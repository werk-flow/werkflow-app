import type { DialogOpenerId } from '../../../lib/testing/selection/dialog-inventory';
import type { DialogOpener } from './dialog-opener';
import { CALENDAR_OPENERS } from './dialog-openers/calendar';
import { CUSTOMERS_OPENERS } from './dialog-openers/customers';
import { DOCUMENTS_OPENERS } from './dialog-openers/documents';
import { INVENTORY_OPENERS } from './dialog-openers/inventory';
import { PEOPLE_OPENERS } from './dialog-openers/people';
import { REQUESTS_OPENERS } from './dialog-openers/requests';
import { SERVICE_OPENERS } from './dialog-openers/service';
import { SETTINGS_OPENERS } from './dialog-openers/settings';
import { TIME_OPENERS } from './dialog-openers/time';
import { WORK_OPENERS } from './dialog-openers/work';

/**
 * Every opener the dialog inventory names, one module per area under
 * dialog-openers/. A `Record` over the inventory's opener ids, so an audited
 * dialog without an opener does not compile.
 */
export const DIALOG_OPENERS: Readonly<Record<DialogOpenerId, DialogOpener>> = {
  ...CALENDAR_OPENERS,
  ...CUSTOMERS_OPENERS,
  ...DOCUMENTS_OPENERS,
  ...INVENTORY_OPENERS,
  ...PEOPLE_OPENERS,
  ...REQUESTS_OPENERS,
  ...SERVICE_OPENERS,
  ...SETTINGS_OPENERS,
  ...TIME_OPENERS,
  ...WORK_OPENERS,
};
