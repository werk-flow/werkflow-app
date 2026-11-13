import { DocumentCompanyProfileForm } from '@/components/settings/document-company-profile-form';
import { DocumentLetterheadFiles } from '@/components/settings/document-letterhead-files';
import { DocumentSamplePreview } from '@/components/settings/document-sample-preview';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { readCompanyProfile } from '@/lib/company-profile/reads';
import { isManagerRole } from '@/lib/roles';
import { readSettingsSectionMembership } from '@/lib/settings/section-access';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// Admin and Büro open this section; an employee goes to their profile
// (lib/settings/sections.ts). The profile reader, every action and the PDF's
// route handler check the role again.
export default async function DokumenteSettingsPage() {
  const { membership } = await readSettingsSectionMembership('dokumente');
  const stored = await readCompanyProfile(createSupabaseAdminClient(), {
    orgId: membership.orgId,
    isManagerOrAbove: isManagerRole(membership.role),
  });
  if (!stored.success) {
    return (
      <RegionLoadError title="Firmenangaben nicht geladen">
        Die Firmenangaben konnten nicht geladen werden.
      </RegionLoadError>
    );
  }
  const { profile } = stored;
  return (
    <div className="space-y-6">
      <DocumentCompanyProfileForm
        organizationId={membership.orgId}
        version={profile.version}
        details={profile.details}
        stationery={{
          first: profile.files.stationery_first !== null,
          following: profile.files.stationery_following !== null,
        }}
      />
      <DocumentLetterheadFiles organizationId={membership.orgId} files={profile.files} />
      <DocumentSamplePreview profileUpdatedAt={profile.updatedAt} />
    </div>
  );
}
