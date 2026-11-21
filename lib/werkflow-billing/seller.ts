import type { InvoiceSeller } from '@/lib/invoicing/model';
import { WerkflowInvoiceFailure } from '@/lib/werkflow-billing/failure';

// WerkFlow as the seller of its own invoices. Every detail is server
// configuration (docs/technical/environments.md, "Credentials"), never code:
// pre-production holds a made-up seller, production WerkFlow's own.

export type WerkflowSeller = {
  seller: InvoiceSeller;
  /** Gläubiger-Identifikationsnummer of WerkFlow's SEPA direct debits (BT-90). */
  creditorId: string;
};

type SellerEnvironment = Readonly<Record<string, string | undefined>>;

const value = (environment: SellerEnvironment, name: string): string | null =>
  environment[name]?.trim() || null;

function required(environment: SellerEnvironment, name: string): string {
  const found = value(environment, name);
  if (!found) throw new WerkflowInvoiceFailure('werkflow_seller_configuration_missing');
  return found;
}

/**
 * WerkFlow's seller block from `WERKFLOW_SELLER_*`. Name, street, postal code,
 * city, Steuernummer, e-mail and creditor ID are required; the USt-IdNr. and
 * the Handelsregisternummer are optional. The creditor ID is also the seller
 * identifier (BT-29), so a sole trader under § 19 UStG without either meets
 * BR-CO-26. It has no scheme: CII accepts only ISO 6523 codes, and `SEPA` is
 * none.
 */
export function readWerkflowSeller(environment: SellerEnvironment = process.env): WerkflowSeller {
  const creditorId = required(environment, 'WERKFLOW_SELLER_CREDITOR_ID');
  return {
    seller: {
      name: required(environment, 'WERKFLOW_SELLER_NAME'),
      address: {
        lines: [required(environment, 'WERKFLOW_SELLER_STREET')],
        postalCode: required(environment, 'WERKFLOW_SELLER_POSTAL_CODE'),
        city: required(environment, 'WERKFLOW_SELLER_CITY'),
        countryCode: 'DE',
      },
      vatId: value(environment, 'WERKFLOW_SELLER_VAT_ID'),
      taxNumber: required(environment, 'WERKFLOW_SELLER_TAX_NUMBER'),
      legalRegistrationId: value(environment, 'WERKFLOW_SELLER_REGISTRATION_ID'),
      identifier: { id: creditorId, scheme: null },
      email: required(environment, 'WERKFLOW_SELLER_EMAIL'),
    },
    creditorId,
  };
}
