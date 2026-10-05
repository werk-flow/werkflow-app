'use client';

import { Badge } from '@/components/ui/badge';
import { MetadataSection, type MetadataField } from '@/components/shared/metadata-section';
import type { OrgRole, MemberDetail } from '@/lib/members/actions';
import { ROLE_LABELS } from '@/lib/roles';
import { formatGermanDate } from '@/lib/utils';

type MitarbeiterDetailProfileSectionProps = {
  member: MemberDetail;
  canManage: boolean;
  roleOptions: { value: OrgRole; label: string }[] | undefined;
  onRoleChange: (role: OrgRole) => Promise<void>;
};

export function MitarbeiterDetailProfileSection({
  member,
  canManage,
  roleOptions,
  onRoleChange,
}: MitarbeiterDetailProfileSectionProps) {
  const metadataFields: MetadataField[] = [
    { label: 'Vorname', value: member.firstName || '—' },
    { label: 'Nachname', value: member.lastName || '—' },
    { label: 'E-Mail', value: member.email || '—' },
    {
      label: 'Rolle',
      value: (
        <Badge variant="secondary" className="text-xs">
          {ROLE_LABELS[member.role] || member.role}
        </Badge>
      ),
      editableConfig: roleOptions
        ? {
            type: 'select' as const,
            currentValue: member.role,
            onSave: async (v: string) => {
              await onRoleChange(v as OrgRole);
            },
            options: roleOptions,
          }
        : undefined,
    },
    {
      label: 'Beigetreten',
      value: formatGermanDate(member.joinedAt),
    },
  ];

  return <MetadataSection title="Profil" fields={metadataFields} isEditable={canManage} />;
}
