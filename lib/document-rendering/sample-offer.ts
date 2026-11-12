import { addLocalDays } from '@/lib/date-time/berlin';
import { formatGermanDate } from '@/lib/utils';

import type { BusinessDocument, DocumentPosition } from './model';

const position = (
  number: string,
  text: string,
  quantity: string,
  unitLabel: string,
  unitPriceCents: number,
  amountCents: number,
  details: Partial<Pick<DocumentPosition, 'description' | 'kind'>> = {},
): DocumentPosition => ({
  number,
  text,
  description: details.description ?? '',
  quantity,
  unitLabel,
  unitPriceCents,
  amountCents,
  kind: details.kind ?? 'standard',
});

/**
 * The fixed Musterangebot the settings show: a heating replacement for a made-up
 * customer, sent by the viewer's organization and dated the day it is shown.
 * Bedarfs- and Alternativposition stay out of the subtotal.
 */
export function sampleOffer(organizationName: string, issuedOn: string): BusinessDocument {
  return {
    issuedOn,
    sender: { name: organizationName, addressLines: [], logo: null },
    recipientLines: ['Hausverwaltung Ahornhof GmbH', 'Ahornweg 7', '09876 Ahornstadt'],
    title: 'Angebot: Austausch der Gasheizung',
    metaRows: [
      { label: 'Angebot', value: 'Muster' },
      { label: 'Datum', value: formatGermanDate(issuedOn) },
      { label: 'Gültig bis', value: formatGermanDate(addLocalDays(issuedOn, 30)) },
      { label: 'Objekt', value: 'Ahornweg 7, 09876 Ahornstadt' },
    ],
    openingText:
      'Sehr geehrte Damen und Herren,\nvielen Dank für die Anfrage. Gerne bieten wir die folgenden Leistungen an.',
    sections: [
      {
        number: '1',
        title: 'Demontage',
        positions: [
          position('1.1', 'Gas-Heizwertkessel demontieren', '1', 'Stk.', 38000, 38000, {
            description: 'Anlage außer Betrieb nehmen, entleeren und vom Netz trennen.',
          }),
          position('1.2', 'Altgerät entsorgen', '1', 'psch.', 9500, 9500),
        ],
        subtotalCents: 47500,
      },
      {
        number: '2',
        title: 'Wärmeerzeuger',
        positions: [
          position('2.1', 'Gas-Brennwertgerät 25 kW liefern', '1', 'Stk.', 489000, 489000, {
            description:
              'Wandhängendes Gas-Brennwertgerät mit modulierendem Brenner, witterungsgeführter Regelung und Außenfühler.',
          }),
          position('2.2', 'Montage und Inbetriebnahme', '6.5', 'Std.', 7200, 46800),
          position('2.3', 'Abgassystem Kunststoff DN 80', '1', 'Set', 64000, 64000),
          position('2.4', 'Neutralisationsbox', '1', 'Stk.', 18500, 18500, {
            kind: 'bedarf',
            description: 'Nur wenn der Abwasseranschluss sie verlangt; nicht in der Summe enthalten.',
          }),
          position('2.5', 'Gas-Brennwertgerät 20 kW liefern', '1', 'Stk.', 452000, 452000, {
            kind: 'alternative',
            description: 'Statt Position 2.1; nicht in der Summe enthalten.',
          }),
        ],
        subtotalCents: 599800,
      },
      {
        number: '3',
        title: 'Anfahrt',
        positions: [position('3.1', 'Anfahrtspauschale', '1', 'psch.', 4500, 4500)],
        subtotalCents: 4500,
      },
    ],
    totals: {
      byRate: [{ rateBasisPoints: 1900, netCents: 651800, vatCents: 123842, grossCents: 775642 }],
      netCents: 651800,
      vatCents: 123842,
      grossCents: 775642,
    },
    closingText: `Wir freuen uns auf den Auftrag und stehen für Fragen jederzeit zur Verfügung.\n\nMit freundlichen Grüßen\n${organizationName}`,
    footerColumns: [],
    stationery: null,
  };
}
