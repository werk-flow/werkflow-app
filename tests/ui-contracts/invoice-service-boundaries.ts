// Isolated stand-in for `@/lib/invoices/actions`: the job, project, customer
// and Servicefall pages offer „Rechnung erstellen“, whose dialog downloads on
// intent. No contract creates, saves or deletes an invoice.
import { unexpectedWrite } from './held-write-boundary';

export const createInvoice = unexpectedWrite;
export const saveInvoiceDraft = unexpectedWrite;
export const deleteInvoiceDraft = unexpectedWrite;
