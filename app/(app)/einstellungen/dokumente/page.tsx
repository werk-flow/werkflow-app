import { DocumentSamplePreview } from '@/components/settings/document-sample-preview';
import { readSettingsSectionMembership } from '@/lib/settings/section-access';

// Admin and Büro open this section; an employee goes to their profile
// (lib/settings/sections.ts). The PDF's route handler checks the role again.
export default async function DokumenteSettingsPage() {
  await readSettingsSectionMembership('dokumente');
  return <DocumentSamplePreview />;
}
