import 'server-only';

import { artikelFinden } from '@/lib/ai/tools/artikel-finden';
import { auftraegeFinden } from '@/lib/ai/tools/auftraege-finden';
import type { AiTool } from '@/lib/ai/tools/define-tool';
import { frageStellen } from '@/lib/ai/tools/frage-stellen';
import { kundenFinden } from '@/lib/ai/tools/kunden-finden';
import { lieferscheinLesen } from '@/lib/ai/tools/lieferschein-lesen';
import { planZeigen } from '@/lib/ai/tools/plan-zeigen';
import type { OrgRole } from '@/lib/roles';

/** Every tool WerkFlow KI has. A tool ships here only with its boundary cases (B5). */
export const AI_TOOLS = [
  auftraegeFinden,
  kundenFinden,
  artikelFinden,
  lieferscheinLesen,
  frageStellen,
  planZeigen,
] as const;

/** The tools a person of `role` may use; the model never sees another (B6). */
export function aiToolsFor(role: OrgRole): readonly AiTool[] {
  return AI_TOOLS.filter((tool) => tool.roles.includes(role));
}
