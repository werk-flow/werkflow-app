import { cryptoRandom } from './fake-text';
import { loadUiStringCatalog } from './load-ui-string-catalog';
import { pageToSvg, rasterizeSvg } from './rasterize';
import { redrawPage } from './redraw-page';

// The one entry of the screenshot redraw. The report dialog imports this
// module lazily, so the catalog and the redraw never ride in a cold start.

/**
 * The visible page as a PNG in which only the app's own UI strings stay
 * readable. It runs on the device and uploads nothing. It throws when the
 * catalog is missing or the device cannot draw: a report then has no
 * screenshot, never an unredrawn one.
 */
export async function redrawScreenshot(): Promise<Blob> {
  const page = redrawPage(document, loadUiStringCatalog(), cryptoRandom);
  return rasterizeSvg(await pageToSvg(page, document), page, document);
}
