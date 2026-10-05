import 'server-only';

import { revalidatePath } from 'next/cache';

/** The views that show work evidence: the work pages, the task list and the document library. */
export function revalidateWorkEvidenceViews(): void {
  revalidatePath('/auftraege', 'layout');
  revalidatePath('/aufgaben', 'layout');
  revalidatePath('/dokumente', 'layout');
}
