// The stable codes a WerkFlow invoice fails with. The signal endpoint keeps the
// code with the failed signal and Stripe delivers it again; the alarm reads it
// (A6a, werk-flow/werkflow-planning#251). A code names no person, amount or value.
type WerkflowInvoiceFailureCode =
  | 'werkflow_seller_configuration_missing'
  | 'werkflow_invoice_unreadable'
  | 'werkflow_invoice_not_finalized'
  | 'werkflow_invoice_organization_unknown'
  | 'werkflow_invoice_payment_pending'
  | 'werkflow_invoice_amount_mismatch'
  | 'werkflow_invoice_rules_failed'
  | 'werkflow_invoice_readback_mismatch'
  | 'werkflow_invoice_storage_conflict'
  | 'werkflow_invoice_record_failed';

export class WerkflowInvoiceFailure extends Error {
  constructor(readonly code: WerkflowInvoiceFailureCode) {
    super(code);
    this.name = 'WerkflowInvoiceFailure';
  }
}
