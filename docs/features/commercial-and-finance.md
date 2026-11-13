# Commercial and finance

The commercial loop takes an SHK business from a customer request to agreed scope, a correct invoice, collected payment and an understandable job result, using the operational record of customers, jobs, time, documents and material. Every legally or financially consequential action stays explicit, reviewable and audited. Native accounting, payroll and tax filing are separate product decisions.

## Current Product Baseline

WerkFlow has no commercial or finance module. Admin and Büro work with the operational records that the commercial loop will consume.

- **Company profile.** Under „Einstellungen“, „Dokumente & Briefpapier“, Admin and Büro keep one profile per organization: firm with legal form, address, contact, register court and number, management or owner, tax number, USt-IdNr., bank details, a logo, stationery for the first and the following pages with their margins, and the opening text, closing text, validity in days and tax rate without an article that a new offer starts with. Each change records who changed which field, from which value to which. A hint names the details a business letter usually carries that are still missing; nothing waits for them. Employees read no profile field. A concurrent save from an older version is refused and asks for a reload, and so is a save from a page loaded for an organization that is no longer the active one. Stationery margins that leave the offer too little room mark the sides at fault. The organization export carries the profile, its history, and the logo and stationery under `Dateien/Briefpapier`.
- **Offer print.** The same section shows a fixed Musterangebot as the PDF a customer would get, with the profile, a made-up customer and made-up prices. They open or download it. Without stationery the PDF draws a letterhead from logo and details and a footer with the company details; with stationery it draws neither, because the paper carries them. Bedarfs- and Alternativposition amounts stand in parentheses, outside the sum. Employees see neither the section nor the file. The PDF comes from the one renderer of generated documents ([document storage](../technical/document-storage-and-access.md#generated-documents)).

- **Documents.** Jobs, projects, customers and service cases hold linked documents, and the central library stores business documents. An uploaded PDF is not a structured offer, contract, invoice, incoming bill, payment or accounting record.
- **Inventory prices.** Articles carry purchase price, sale price, tax rate and billable defaults. One server reader gives Admin and Büro an article's base unit, net purchase cost and list sale price in cents per price quantity of base units, its tax rate, the date the price applies from and its source; an archived article answers too, and a field worker is refused. A line amount is quantity × price ÷ price quantity, rounded half away from zero to the cent once per line, in integer arithmetic. A recorded use of job material keeps the purchase price of that moment. No workflow turns them into offers, invoices, revenue or profit.
- **Time.** Time entries attach to operational work. No billable-time handoff, labor calculation, rate card or post-calculation exists. The payroll-ready time export carries minutes only and creates no wage calculation, posting, billable labor or invoice.
- **Measurements and change work.** Aufmaß and Regie- or Änderungsnachweise carry internal decisions and customer-response evidence. They carry no price, scope acceptance, billing release or invoice effect.
- **Handover readiness.** An office-reviewed handover can be released as ready for commercial review, with or without exceptions. The release creates no calculation, price, tax decision, billable quantity, offer, invoice, payment or message.

### Current limits

- An article keeps one current purchase and sale price per base unit. The price reader dates it by the article's last save, whatever field changed, and answers it for every date.
- No offer uses the profile's offer defaults or tax rate yet; the Musterangebot shows the texts and the validity and keeps its fixed 19 %.
- Not built: price catalog, calculation, offer, order confirmation, contract, change order, billable measurement, invoice, credit, incoming bill, payment, open item, dunning, bank matching, accounting export, ledger.
- WerkFlow claims no XRechnung, ZUGFeRD, Peppol, DATEV, GAEB, REB/VOB, §13b, GoBD archive, double-entry accounting, payroll or tax-filing capability.
