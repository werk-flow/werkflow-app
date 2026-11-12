// The plain model of a generated business document. A caller maps its own
// records into it; the renderer knows no offer, customer or database type.
// Amounts arrive computed: the renderer formats and places them, it never
// adds, rounds or taxes.

/** A logo or an image stationery page. */
export type DocumentImage = { format: 'png' | 'jpeg'; bytes: Uint8Array };

/** A stationery page: an image, or the first page of a PDF. */
export type StationeryFile = DocumentImage | { format: 'pdf'; bytes: Uint8Array };

/** Distances from the paper's edges, in millimetres, that the content keeps clear. */
export type PageMargins = { topMm: number; rightMm: number; bottomMm: number; leftMm: number };

export type StationeryPage = { file: StationeryFile; margins: PageMargins };

type DocumentStationery = {
  firstPage: StationeryPage;
  /** Without it, the following pages get no underlay and the plain margins. */
  followingPages: StationeryPage | null;
};

export type DocumentPosition = {
  /** As printed, for example `1.3`. */
  number: string;
  text: string;
  /** Paragraphs separated by line breaks; empty for none. */
  description: string;
  /** A decimal string with up to three decimals, for example `12.5`. */
  quantity: string;
  unitLabel: string;
  unitPriceCents: number;
  amountCents: number;
  kind: 'standard' | 'bedarf' | 'alternative';
};

export type DocumentSection = {
  number: string;
  title: string;
  positions: DocumentPosition[];
  subtotalCents: number;
};

type TaxRateTotal = {
  rateBasisPoints: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
};

export type BusinessDocument = {
  /** The document's date as `YYYY-MM-DD`; it also dates the PDF, so a render repeats byte for byte. */
  issuedOn: string;
  sender: {
    name: string;
    addressLines: string[];
    logo: DocumentImage | null;
  };
  recipientLines: string[];
  title: string;
  metaRows: Array<{ label: string; value: string }>;
  openingText: string;
  sections: DocumentSection[];
  totals: {
    byRate: TaxRateTotal[];
    netCents: number;
    vatCents: number;
    grossCents: number;
  };
  closingText: string;
  /** Small print columns at the foot of each page; stationery carries its own, so they print only without it. */
  footerColumns: string[][];
  stationery: DocumentStationery | null;
};
