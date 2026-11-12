# Commercial and finance

The commercial loop takes an SHK business from a customer request to agreed scope, a correct invoice, collected payment and an understandable job result, using the operational record of customers, jobs, time, documents and material. Every legally or financially consequential action stays explicit, reviewable and audited. Native accounting, payroll and tax filing are separate product decisions.

## Current Product Baseline

WerkFlow has no offer, order or invoice yet. Admin and Büro keep a catalog of Leistungen and work with the operational records that the commercial loop will consume.

- **Documents.** Jobs, projects, customers and service cases hold linked documents, and the central library stores business documents. An uploaded PDF is not a structured offer, contract, invoice, incoming bill, payment or accounting record.
- **Leistungen.** Under „Angebote“ → „Leistungen“, Admin and Büro keep priced services without an article: number, name, description, kind (Arbeit, Anfahrt, Pauschale, Gebühr, Fremdleistung), a unit from the inventory unit list and a VAT rate of 19, 7 or 0 %. Each price is a version with a first valid day, a net sale price and an optional internal cost rate in cents per unit. A recorded version never changes and is never deleted: a later price starts on its own day, and a second price for the same day replaces the first for every later read while the history keeps both. A Leistung is archived and restored, never deleted. The list shows today's price and the day of a coming one, pages and searches on the server, and its price dialog shows every version. One server reader answers the price of named Leistungen on a day, shaped like the article price reader. Field workers see neither the area nor any row; the database grants the tables to no signed-in role (`supabase/tests/leistung_prices.sql`).
- **Inventory prices.** Articles carry purchase price, sale price, tax rate and billable defaults. One server reader gives Admin and Büro an article's base unit, net purchase cost and list sale price in cents per price quantity of base units, its tax rate, the date the price applies from and its source; an archived article answers too, and a field worker is refused. A line amount is quantity × price ÷ price quantity, rounded half away from zero to the cent once per line, in integer arithmetic. No workflow turns them into offers, invoices, revenue or profit.
- **Time.** Time entries attach to operational work. No billable-time handoff, labor calculation, rate card or post-calculation exists. The payroll-ready time export carries minutes only and creates no wage calculation, posting, billable labor or invoice.
- **Measurements and change work.** Aufmaß and Regie- or Änderungsnachweise carry internal decisions and customer-response evidence. They carry no price, scope acceptance, billing release or invoice effect.
- **Handover readiness.** An office-reviewed handover can be released as ready for commercial review, with or without exceptions. The release creates no calculation, price, tax decision, billable quantity, offer, invoice, payment or message.

### Current limits

- An article keeps one current purchase and sale price per base unit. The price reader dates it by the article's last save, whatever field changed, and answers it for every date.
- A Leistung's price applies per one unit; a VAT rate other than 19, 7 or 0 % cannot be chosen. No offer uses a Leistung yet.
- Not built: calculation, offer, order confirmation, contract, change order, billable measurement, invoice, credit, incoming bill, payment, open item, dunning, bank matching, accounting export, ledger.
- WerkFlow claims no XRechnung, ZUGFeRD, Peppol, DATEV, GAEB, REB/VOB, §13b, GoBD archive, double-entry accounting, payroll or tax-filing capability.
