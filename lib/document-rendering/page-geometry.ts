import type { PageMargins } from './model';

// Where the content of a generated business document goes on an A4 page, and
// which stationery margins leave it too little room. It imports nothing of
// the server, so the settings form checks a draft as the renderer does.

export const MM = 72 / 25.4;
export const PAGE_WIDTH = 210 * MM;
export const PAGE_HEIGHT = 297 * MM;

/** The plain letter's margins; the first page's address field and info block sit where DIN 5008 (form B) puts them. */
export const PLAIN_MARGINS: PageMargins = { topMm: 20, rightMm: 20, bottomMm: 15, leftMm: 25 };
const FIRST_PAGE_CONTENT_TOP_MM = 100;
/** Where form B's address field starts; a stationery top margin below it moves the field down. */
const ADDRESS_FIELD_TOP_MM = 45;
/** The narrowest content a page may leave: the table and the info block's values need this much. */
const MINIMUM_CONTENT_WIDTH_MM = 120;
const MINIMUM_INFO_VALUE_WIDTH_MM = 25;
const MINIMUM_CONTENT_HEIGHT_MM = 120;
export const INFO_BLOCK_LEFT_MM = 125;
/** The width of the info block's labels; its values start after them. */
export const INFO_LABEL_WIDTH_MM = 30;
const PAGE_NUMBER_SPACE = 8 * MM;

export type Box = { left: number; right: number; top: number; bottom: number };

type StationeryMargins = { firstPage: PageMargins; followingPages: PageMargins | null };

/**
 * Why a page's margins leave the content too little room: the sides together
 * leave it too narrow or too low, or the right margin leaves the first page's
 * info block no room for its values.
 */
export type MarginShortage = 'width' | 'height' | 'info_block';

function boxFromMargins(margins: PageMargins, minimumTopMm: number): Box {
  return {
    left: margins.leftMm * MM,
    right: PAGE_WIDTH - margins.rightMm * MM,
    top: Math.max(margins.topMm, minimumTopMm) * MM,
    bottom: PAGE_HEIGHT - margins.bottomMm * MM - PAGE_NUMBER_SPACE,
  };
}

function shortagesOf(box: Box, infoBlock: boolean): MarginShortage[] {
  return [
    ...(box.right - box.left < MINIMUM_CONTENT_WIDTH_MM * MM ? (['width'] as const) : []),
    ...(box.bottom - box.top < MINIMUM_CONTENT_HEIGHT_MM * MM ? (['height'] as const) : []),
    ...(infoBlock &&
    box.right - (INFO_BLOCK_LEFT_MM + INFO_LABEL_WIDTH_MM) * MM < MINIMUM_INFO_VALUE_WIDTH_MM * MM
      ? (['info_block'] as const)
      : []),
  ];
}

function layout(stationery: StationeryMargins | null, footerHeightMm: number) {
  const plainMargins = { ...PLAIN_MARGINS, bottomMm: PLAIN_MARGINS.bottomMm + footerHeightMm };
  const addressShift = Math.max(0, (stationery?.firstPage.topMm ?? 0) - ADDRESS_FIELD_TOP_MM) * MM;
  const firstBox = boxFromMargins(
    stationery?.firstPage ?? plainMargins,
    FIRST_PAGE_CONTENT_TOP_MM + addressShift / MM,
  );
  const followingBox = boxFromMargins(stationery?.followingPages ?? plainMargins, 0);
  return {
    firstBox,
    followingBox,
    addressShift,
    shortages: { firstPage: shortagesOf(firstBox, true), followingPages: shortagesOf(followingBox, false) },
  };
}

/** The content boxes of the first and the following pages, and how far the address field moves down. */
export function pageGeometry(
  stationery: StationeryMargins | null,
  footerHeightMm: number,
): { firstBox: Box; followingBox: Box; addressShift: number } {
  const { firstBox, followingBox, addressShift, shortages } = layout(stationery, footerHeightMm);
  if (shortages.firstPage.length > 0 || shortages.followingPages.length > 0) {
    throw new Error('document_margins_leave_no_room');
  }
  return { firstBox, followingBox, addressShift };
}

/**
 * What the stationery margins of one page leave the content too little room
 * for; empty when they fit. A page's room depends on its own margins only.
 */
export function stationeryPageShortages(
  page: keyof StationeryMargins,
  margins: PageMargins,
): MarginShortage[] {
  return layout({ firstPage: margins, followingPages: margins }, 0).shortages[page];
}

/** Whether stationery with these margins leaves the content the room a document needs. */
export function stationeryMarginsFit(margins: StationeryMargins): boolean {
  const { shortages } = layout(margins, 0);
  return shortages.firstPage.length === 0 && shortages.followingPages.length === 0;
}
