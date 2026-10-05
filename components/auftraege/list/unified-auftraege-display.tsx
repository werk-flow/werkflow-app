import { InlinePending } from '@/components/ui/inline-pending';
import { getInitials } from '@/lib/members/profile-name';
import type { OrgMemberOption } from '../shared/employee-multi-select';

export function ActiveWorkIndicator() {
  return (
    <span
      className="relative ml-2 inline-flex h-2.5 w-2.5 shrink-0"
      title="Jemand arbeitet gerade an diesem Auftrag"
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
    </span>
  );
}

export function buildMemberLookup(members: OrgMemberOption[]): Map<string, OrgMemberOption> {
  const map = new Map<string, OrgMemberOption>();
  for (const m of members) map.set(m.userId, m);
  return map;
}

export function AvatarStack({
  userIds,
  memberLookup,
  max = 3,
}: {
  userIds: string[];
  memberLookup: Map<string, OrgMemberOption>;
  max?: number | undefined;
}) {
  if (userIds.length === 0) return <span className="text-muted-foreground/50">—</span>;

  const visible = userIds.slice(0, max);
  const overflow = userIds.length - max;

  return (
    <div className="flex -space-x-1.5">
      {visible.map((uid) => {
        const member = memberLookup.get(uid);
        const initials = member ? getInitials(member.firstName, member.lastName) : '?';
        const fullName = member ? `${member.firstName} ${member.lastName}` : 'Unbekannt';
        return (
          <span
            key={uid}
            title={fullName}
            aria-label={fullName}
            className="inline-flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[9px] font-medium text-muted-foreground"
          >
            {initials}
          </span>
        );
      })}
      {overflow > 0 && (
        <span
          title={userIds
            .slice(max)
            .map((uid) => {
              const member = memberLookup.get(uid);
              return member ? `${member.firstName} ${member.lastName}` : 'Unbekannt';
            })
            .join(', ')}
          aria-label={`${overflow} weitere Mitarbeitende`}
          className="inline-flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[9px] font-medium text-muted-foreground"
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

export const SETTLING_LABEL = 'Wird aktualisiert';

export function SettlingIndicator({
  active,
  className,
}: {
  active: boolean;
  className?: string | undefined;
}) {
  return <InlinePending active={active} label={SETTLING_LABEL} className={className} />;
}
