// The run-time EN 16931 rule check of the invoice core, without Java: the CEN
// validation artefacts for CII (lib/invoicing/rules, compiled for SaxonJS) run
// on the XML that to-en16931.ts wrote. A failed rule comes back with its id,
// the CEN message and the field of the invoice model at fault.
//
// It checks the CEN business rules only. The XML schema of CII is not checked
// here; Mustang is to check the writer's output on the reference invoices in
// CI (werk-flow/werkflow-planning#455).
// A check that cannot run throws: no invoice counts as valid that no check read.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

import SaxonJS from 'saxon-js';

import { z } from '@/lib/zod';

import { EN16931_CII_RULES } from './rules/manifest';

export type En16931Finding = {
  /** The CEN rule, for example `BR-CO-15` or `BR-S-02`. */
  ruleId: string;
  /** The model field at fault, for example `seller.vatId`, `lines[2].unitPriceCents` or `totals`. */
  field: string;
  /** The CEN rule text, in English. */
  message: string;
};

export type En16931Check = {
  /** True when no fatal rule failed. */
  valid: boolean;
  errors: En16931Finding[];
  warnings: En16931Finding[];
  /** The CEN artefacts release that checked it, for example `1.3.17`. */
  rulesRelease: string;
};

const SVRL = 'http://purl.oclc.org/dsdl/svrl';

const failedAssertsSchema = z.array(
  z.object({ id: z.string(), flag: z.string(), location: z.string(), text: z.string() }),
);

// Read once per server instance; `new URL(…, import.meta.url)` lets the bundler trace the file.
let compiledRules: Promise<unknown> | null = null;

async function loadRules(): Promise<unknown> {
  const gzipped = await readFile(new URL('./rules/en16931-cii.sef.json.gz', import.meta.url));
  const digest = createHash('sha256').update(gzipped).digest('hex');
  if (digest !== EN16931_CII_RULES.sefGzipSha256)
    throw new Error('The compiled EN 16931 rules are not the recorded ones.');
  return JSON.parse(gunzipSync(gzipped).toString('utf8'));
}

function rules(): Promise<unknown> {
  compiledRules ??= loadRules().catch((error: unknown) => {
    compiledRules = null;
    throw error;
  });
  return compiledRules;
}

/** Rules whose context is not the element at fault. */
const RULE_FIELDS: Record<string, string> = {
  'BR-CO-26': 'seller.vatId',
  'BR-S-02': 'seller.vatId',
  'BR-Z-02': 'seller.vatId',
  'BR-E-02': 'seller.vatId',
  'BR-CO-25': 'paymentTerms',
  'BR-61': 'payee.iban',
  'BR-06': 'seller.name',
  'BR-07': 'buyer.name',
};

/** Line rules whose context is the whole line. */
const LINE_RULE_FIELDS: Record<string, string> = {
  'BR-21': 'id',
  'BR-22': 'quantity',
  'BR-23': 'unitCode',
  'BR-CL-23': 'unitCode',
  'BR-24': 'netCents',
  'BR-25': 'name',
  'BR-26': 'unitPriceCents',
  'BR-27': 'unitPriceCents',
};

const PARTY_FIELDS: Record<string, string> = {
  Name: 'name',
  PostalTradeAddress: 'address',
  URIUniversalCommunication: 'email',
  SpecifiedTaxRegistration: 'vatId',
};

const LINE_FIELDS: Record<string, string> = {
  AssociatedDocumentLineDocument: 'id',
  SpecifiedTradeProduct: 'name',
  NetPriceProductTradePrice: 'unitPriceCents',
  BilledQuantity: 'quantity',
  ApplicableTradeTax: 'tax',
  SpecifiedTradeSettlementLineMonetarySummation: 'netCents',
};

const DOCUMENT_FIELDS: Record<string, string> = {
  ID: 'number',
  TypeCode: 'typeCode',
  IssueDateTime: 'issueDate',
  IncludedNote: 'notes',
};

const HEADER_FIELDS: Record<string, string> = {
  BuyerReference: 'buyerReference',
  BuyerOrderReferencedDocument: 'orderReference',
  ShipToTradeParty: 'deliverTo',
  ActualDeliverySupplyChainEvent: 'delivery',
  BillingSpecifiedPeriod: 'delivery',
  InvoiceCurrencyCode: 'currency',
  SpecifiedTradeSettlementPaymentMeans: 'payee',
  SpecifiedTradePaymentTerms: 'paymentTerms',
  SpecifiedTradeSettlementHeaderMonetarySummation: 'totals',
  InvoiceReferencedDocument: 'precedingInvoice',
};

/** EN 16931 business terms of the model, for rules whose context is the whole invoice. */
const TERM_FIELDS: Record<string, string> = {
  'BT-1': 'number',
  'BT-2': 'issueDate',
  'BT-3': 'typeCode',
  'BT-5': 'currency',
  'BT-9': 'paymentTerms',
  'BT-10': 'buyerReference',
  'BT-13': 'orderReference',
  'BT-20': 'paymentTerms',
  'BT-22': 'notes',
  'BG-3': 'precedingInvoice',
  'BT-25': 'precedingInvoice',
  'BG-4': 'seller',
  'BT-27': 'seller.name',
  'BT-30': 'seller.vatId',
  'BT-31': 'seller.vatId',
  'BT-32': 'seller.vatId',
  'BT-34': 'seller.email',
  'BG-5': 'seller.address',
  'BT-40': 'seller.address',
  'BG-7': 'buyer',
  'BT-44': 'buyer.name',
  'BT-48': 'buyer.vatId',
  'BG-8': 'buyer.address',
  'BT-55': 'buyer.address',
  'BG-13': 'deliverTo',
  'BT-72': 'delivery',
  'BG-14': 'delivery',
  'BG-16': 'payee',
  'BT-81': 'payee',
  'BT-84': 'payee.iban',
  'BG-22': 'totals',
  'BT-106': 'totals',
  'BT-109': 'totals',
  'BT-110': 'totals',
  'BT-112': 'totals',
  'BT-115': 'totals',
  'BG-23': 'taxSubtotals',
  'BG-25': 'lines',
};

const BUSINESS_TERM = /\bB[GT]-\d+\b/g;

const SEGMENT = /\*:([A-Za-z]+)\[namespace-uri\(\)='[^']*'\]\[(\d+)\]/g;

/** The model field an SVRL location points to, as to-en16931.ts lays the XML out. */
function fieldOf(ruleId: string, location: string, message: string): string {
  const known = RULE_FIELDS[ruleId];
  if (known) return known;
  const segments = [...location.matchAll(SEGMENT)].map(([, name = '', index = '1']) => ({
    name,
    position: Number(index) - 1,
  }));
  const childOf = (base: string, table: Record<string, string>, from: number) => {
    const child = segments.slice(from).find((segment) => table[segment.name]);
    return child ? `${base}.${table[child.name] ?? ''}` : base;
  };
  for (const [at, segment] of segments.entries()) {
    if (segment.name === 'IncludedSupplyChainTradeLineItem') {
      const line = `lines[${segment.position}]`;
      const field = LINE_RULE_FIELDS[ruleId];
      return field ? `${line}.${field}` : childOf(line, LINE_FIELDS, at + 1);
    }
    if (segment.name === 'SellerTradeParty') return childOf('seller', PARTY_FIELDS, at + 1);
    if (segment.name === 'BuyerTradeParty') return childOf('buyer', PARTY_FIELDS, at + 1);
    if (segment.name === 'ApplicableTradeTax') return `taxSubtotals[${segment.position}]`;
    if (segment.name === 'ExchangedDocument') {
      const child = segments.slice(at + 1).find((next) => DOCUMENT_FIELDS[next.name]);
      return (child && DOCUMENT_FIELDS[child.name]) ?? 'invoice';
    }
    const header = HEADER_FIELDS[segment.name];
    if (header) return header;
  }
  // A rule on the whole invoice names its business terms; the first one the model holds is the field.
  for (const [term] of message.matchAll(BUSINESS_TERM)) {
    const field = TERM_FIELDS[term];
    if (field) return field;
  }
  return 'invoice';
}

/** Runs the CEN EN 16931 rules on CII XML; throws when the check itself cannot run. */
export async function checkEn16931(xml: string): Promise<En16931Check> {
  const stylesheetInternal = await rules();
  const report = await SaxonJS.transform(
    { stylesheetInternal, sourceText: xml, destination: 'document' },
    'async',
  );
  // The invoice-level rules fire only on a CII invoice root; a fragment or another document fires none.
  const rootRules = SaxonJS.XPath.evaluate(
    "count(//svrl:fired-rule[@context = '/rsm:CrossIndustryInvoice'])",
    report.principalResult,
    { namespaceContext: { svrl: SVRL } },
  );
  if (typeof rootRules !== 'number' || rootRules === 0) {
    throw new Error('The EN 16931 rules found no CII invoice in this XML.');
  }
  const failed = failedAssertsSchema.parse(
    SaxonJS.XPath.evaluate(
      "array { //svrl:failed-assert ! map { 'id': string(@id), 'flag': string(@flag), 'location': string(@location), 'text': normalize-space(svrl:text) } }",
      report.principalResult,
      { namespaceContext: { svrl: SVRL } },
    ),
  );
  const errors: En16931Finding[] = [];
  const warnings: En16931Finding[] = [];
  for (const assert of failed) {
    const finding = {
      ruleId: assert.id,
      field: fieldOf(assert.id, assert.location, assert.text),
      message: assert.text,
    };
    // Only an explicit warning passes; an unknown flag counts as fatal.
    (assert.flag === 'warning' ? warnings : errors).push(finding);
  }
  return { valid: errors.length === 0, errors, warnings, rulesRelease: EN16931_CII_RULES.release };
}
