'use client';

import { Badge } from '@/components/ui/badge';
import { MetadataSaveError, MetadataSection, type MetadataField } from '@/components/shared/metadata-section';
import type { MemberDetail } from '@/lib/members/actions';
import { isOrgRole, ROLE_LABELS, type OrgRole } from '@/lib/roles';
import { formatGermanDate } from '@/lib/utils';
import { escalatesToBuero, roleEscalationCopy, type RoleChange } from './role-escalation-confirm-dialog';

type MitarbeiterDetailProfileSectionProps = {
  member: MemberDetail;
  fullName: string;
  canManage: boolean;
  roleOptions: { value: OrgRole; label: string }[] | undefined;
  onRoleChange: RoleChange;
};

export function MitarbeiterDetailProfileSection({
  member,
  fullName,
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
          {ROLE_LABELS[member.role]}
        </Badge>
      ),
      editableConfig: roleOptions
        ? {
            type: 'select' as const,
            currentValue: member.role,
            onSave: async (v: string) => {
              if (!isOrgRole(v)) return;
              // The failure stays at the field, which keeps its editor open.
              const failure = await onRoleChange(v);
              if (failure) throw new MetadataSaveError(failure);
            },
            options: roleOptions,
            confirmBeforeSave: {
              shouldConfirm: (newValue: string, currentValue: string) =>
                isOrgRole(newValue) && isOrgRole(currentValue) && escalatesToBuero(currentValue, newValue),
              ...roleEscalationCopy(fullName),
            },
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
