import { z } from '@/lib/zod';
import type { Database } from '@/lib/supabase/database.types';

// The admin client is untyped, so embedded relations are parsed where they cross in.
export const documentFileSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  current_version_number: z.number(),
  deleted_at: z.string().nullable(),
});
const templateVersionsSchema = z.array(z.object({ id: z.string(), version_number: z.number() }));

export type PersonnelOnboardingTemplateSummary = {
  id: string;
  currentVersionId: string;
  name: string;
  description: string | null;
  state: Database['public']['Enums']['personnel_template_state'];
  currentVersionNumber: number;
  version: number;
};

type TemplateRow = Pick<
  Database['public']['Tables']['personnel_onboarding_templates']['Row'],
  'id' | 'name' | 'description' | 'state' | 'current_version_number' | 'version'
> & { personnel_onboarding_template_versions: unknown };

/** The templates whose current version was read, each with that version's id. */
export function toTemplateSummaries(templates: readonly TemplateRow[]): PersonnelOnboardingTemplateSummary[] {
  return templates.flatMap((template) => {
    const versions = templateVersionsSchema.safeParse(template.personnel_onboarding_template_versions);
    const current = versions.data?.find(
      (version) => version.version_number === template.current_version_number,
    );
    return current
      ? [
          {
            id: template.id,
            currentVersionId: current.id,
            name: template.name,
            description: template.description,
            state: template.state,
            currentVersionNumber: template.current_version_number,
            version: template.version,
          },
        ]
      : [];
  });
}
