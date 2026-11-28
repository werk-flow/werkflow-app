import { formatInventoryQuantity } from '@/lib/inventory/types';
import { z } from '@/lib/zod';

// What the „KI-Entwurf“ card of a read Lieferschein shows (werk-flow/werkflow-planning#535):
// the validated fields the tool returned and stored with its row, never the model's prose.
// A detail of any other shape is no Lieferschein, and the row lists it as before.

const text = z.object({ source: z.string(), text: z.string() }).nullable();
const unitCode = z.string();

const resultSchema = z.object({
  lieferant: text,
  lieferscheinnummer: text,
  datum: z.iso.date().nullable(),
  positionen: z.array(
    z.object({
      nr: z.number(),
      artikelnummer: text,
      ean: z.string().nullable(),
      beschreibung: text,
      menge: z.number().nullable(),
      einheit: text,
      packungsinhalt: z.number().nullable(),
      abgleich: z
        .object({
          artikel: z.object({ name: text, nummer: text, einheit: unitCode.nullable() }).nullable(),
          mengeInBasiseinheit: z.number().nullable(),
          katalog: z.object({ lieferant: text, name: text }).nullable(),
          hinweise: z.array(z.string()),
        })
        .nullable(),
    }),
  ),
  // Null when the extractor could not say how many lines it left out.
  weggelassenePositionen: z.number().nullable(),
  abgleichGelesen: z.boolean(),
});

/** The German words of a match's problem codes (lib/inventory/delivery-matching.ts). */
const PROBLEMS: Readonly<Record<string, string>> = {
  artikel_unbekannt: 'Kein eigener Artikel',
  nur_im_katalog: 'Nur im Großhandelskatalog',
  mehrdeutig: 'Mehrere eigene Artikel mit dieser Nummer',
  menge_fehlt: 'Keine Menge gelesen',
  einheit_unbekannt: 'Einheit nicht in der Einheitenliste',
  einheit_abweichend: 'Einheit passt nicht zum Artikel',
  artikeleinheit_unbekannt: 'Einheit des Artikels nicht in der Einheitenliste',
  packung_unklar: 'Mehrere Umrechnungen für diese Einheit',
  packung_abweichend: 'Packungsinhalt weicht von der hinterlegten Umrechnung ab',
  packung_umgerechnet: 'Packung laut Lieferschein umgerechnet',
  katalog_nicht_gelesen: 'Großhandelskatalog nicht lesbar',
  mehrmals_im_katalog: 'Mehrmals im Großhandelskatalog',
};

type LieferscheinCardLine = {
  nr: number;
  /** As delivered: quantity, unit, number and description. */
  delivered: string;
  /** The own article and its quantity in the article's unit, or the catalog article. */
  match: string | null;
  problems: string[];
  /** Whether the line fits an own article with no doubt: only such a line shows as fitting. */
  fits: boolean;
};

export type LieferscheinCard = {
  title: string;
  facts: string;
  lines: LieferscheinCardLine[];
  /** Lines not read, or null when that count is unknown. */
  left: number | null;
  matched: boolean;
};

const formatDate = (iso: string): string => iso.split('-').toReversed().join('.');
const joined = (parts: Array<string | null | undefined>): string => parts.filter(Boolean).join(' · ');

/** The card of a stored „Lieferschein lesen“ result, or null for a detail of another tool. */
export function lieferscheinCard(result: unknown): LieferscheinCard | null {
  const parsed = resultSchema.safeParse(result);
  if (!parsed.success) return null;
  const read = parsed.data;
  return {
    title: read.lieferscheinnummer ? `Lieferschein ${read.lieferscheinnummer.text}` : 'Lieferschein',
    facts: joined([read.lieferant?.text, read.datum && formatDate(read.datum)]),
    left: read.weggelassenePositionen,
    matched: read.abgleichGelesen,
    lines: read.positionen.map((line) => {
      const pack = line.packungsinhalt === null ? '' : ` à ${line.packungsinhalt.toLocaleString('de-DE')}`;
      const quantity =
        line.menge === null
          ? null
          : `${line.menge.toLocaleString('de-DE')} ${line.einheit?.text ?? ''}${pack}`;
      const match = line.abgleich;
      const article = match?.artikel;
      return {
        nr: line.nr,
        delivered: joined([
          quantity?.trim(),
          line.artikelnummer?.text ?? (line.ean && `EAN ${line.ean}`),
          line.beschreibung?.text,
        ]),
        match: article
          ? joined([
              article.name?.text,
              article.nummer?.text,
              match.mengeInBasiseinheit === null || article.einheit === null
                ? null
                : formatInventoryQuantity(match.mengeInBasiseinheit, article.einheit, 3),
            ])
          : match?.katalog
            ? joined([match.katalog.name?.text, match.katalog.lieferant?.text])
            : null,
        problems: (match?.hinweise ?? []).map((code) => PROBLEMS[code] ?? code),
        fits: Boolean(article) && match?.hinweise.length === 0,
      };
    }),
  };
}
