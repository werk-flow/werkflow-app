// Why a DATANORM line or file is not read, in words the office can act on.
// Each sentence takes the one fact that names the problem: the written
// value, the record type or the version.

const REASONS = {
  file_unknown: () =>
    'Der Dateiname gehört zu keiner DATANORM-Lieferung. Erwartet werden DATANORM.001, DATPREIS.001, DATANORM.WRG und DATANORM.RAB.',
  header_missing: () => 'Die Datei beginnt nicht mit einem Vorlaufsatz (V-Satz) und wird nicht gelesen.',
  header_misplaced: () => 'Ein zweiter Vorlaufsatz (V-Satz) steht mitten in der Datei.',
  version_unsupported: (version: string) =>
    `Die Datei hat die DATANORM-Version „${version}“. WerkFlow liest nur DATANORM 4.`,
  record_type_unknown: (recordType: string) => `Die Satzart „${recordType}“ ist unbekannt.`,
  too_few_fields: (recordType: string) => `Dem ${recordType}-Satz fehlen Felder.`,
  change_unknown: (change: string) => `Die Verarbeitungsart „${change}“ wird nicht gelesen.`,
  article_number_missing: () => 'Die Artikelnummer fehlt.',
  article_missing: (articleNumber: string) =>
    `Zum B-Satz fehlt der A-Satz des Artikels „${articleNumber}“ in dieser Lieferung.`,
  price_not_number: (price: string) => `Der Preis „${price}“ ist keine ganze Zahl in Cent.`,
  price_kind_unknown: (kind: string) =>
    `Das Preiskennzeichen „${kind}“ ist unbekannt. Erlaubt sind 1 (Listenpreis) und 2 (Nettopreis).`,
  price_unit_unknown: (code: string) =>
    `Die Preiseinheit „${code}“ ist unbekannt. Erlaubt sind 0, 1, 2 und 3 (Preis je 1, 10, 100 oder 1000 Einheiten).`,
  discount_not_number: (value: string) =>
    `Der Rabatt „${value}“ ist keine ganze Zahl in Hundertstel Prozent.`,
} satisfies Record<string, (fact: string) => string>;

export type DatanormRejectionCode = keyof typeof REASONS;

/** The German sentence for a rejection, naming the fact that caused it. */
export function datanormRejectionReason(code: DatanormRejectionCode, fact: string): string {
  return REASONS[code](fact);
}
