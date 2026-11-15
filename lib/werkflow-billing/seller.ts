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
 * the Handelsregisternummer are optional, but the EN 16931 check refuses a
 * seller without either (BR-CO-26).
 */
export function readWerkflowSeller(environment: SellerEnvironment = process.env): WerkflowSeller {
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
      email: required(environment, 'WERKFLOW_SELLER_EMAIL'),
    },
    creditorId: required(environment, 'WERKFLOW_SELLER_CREDITOR_ID'),
  };
}
