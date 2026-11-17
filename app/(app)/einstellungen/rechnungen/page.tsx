import { InvoiceSettingsForm } from '@/components/settings/invoice-settings-form';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { readInvoiceSettings } from '@/lib/invoices/settings-reads';
import { logError } from '@/lib/logging';
import { readSettingsSectionMembership } from '@/lib/settings/section-access';

// Admin and Büro open this section, Admin saves it; an employee goes to their
// profile (lib/settings/sections.ts). The action checks the role again.
export default async function RechnungenSettingsPage() {
  const { membership } = await readSettingsSectionMembership('rechnungen');
  const settings = await readInvoiceSettings(membership.orgId).catch((error: unknown) => {
    logError('settings.rechnungen.read_failed', error);
    return null;
  });
  if (!settings) {
    return (
      <RegionLoadError title="Rechnungseinstellungen nicht geladen">
        Die Rechnungseinstellungen sind gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  return (
    <InvoiceSettingsForm
      key={`${membership.orgId}:${settings.version}`}
      organizationId={membership.orgId}
      settings={settings}
      canEdit={membership.role === 'admin'}
    />
  );
}
