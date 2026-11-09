import { z } from '@/lib/zod';
import { type UiStringCatalog } from './ui-string-catalog';

const catalogSchema = z.array(z.string());

/**
 * Parses the catalog the build inlined (next.config.ts). A missing or
 * malformed catalog is a failure, never an empty catalog: the redraw would
 * still hide everything, but a broken build must not pass unnoticed.
 */
function parseUiStringCatalog(serialized: string | undefined): UiStringCatalog {
  if (!serialized) throw new Error('The UI string catalog was not built into this bundle.');
  const parsed: unknown = JSON.parse(serialized);
  return new Set(catalogSchema.parse(parsed));
}

/** The catalog of this build. Next inlines the variable at compile time, only into this lazy chunk. */
export function loadUiStringCatalog(): UiStringCatalog {
  return parseUiStringCatalog(process.env.WERKFLOW_UI_STRING_CATALOG);
}
