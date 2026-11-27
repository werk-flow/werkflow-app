import 'server-only';

import { artikelFinden } from '@/lib/ai/tools/artikel-finden';
import { auftraegeFinden } from '@/lib/ai/tools/auftraege-finden';
import { auftragLesen } from '@/lib/ai/tools/auftrag-lesen';
import type { AiTool } from '@/lib/ai/tools/define-tool';
import { kundenFinden } from '@/lib/ai/tools/kunden-finden';
import type { OrgRole } from '@/lib/roles';

/** Every tool WerkFlow KI has. A tool ships here only with its boundary cases (B5). */
export const AI_TOOLS = [auftraegeFinden, auftragLesen, kundenFinden, artikelFinden] as const;

/** The tools a person of `role` may use; the model never sees another (B6). */
export function aiToolsFor(role: OrgRole): readonly AiTool[] {
  return AI_TOOLS.filter((tool) => tool.roles.includes(role));
}
