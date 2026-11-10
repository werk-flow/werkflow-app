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
  if (userIds.length === 0) return <span className="text-muted-foreground">—</span>;

  const visible = userIds.slice(0, max);
  const overflow = userIds.length - max;
  const nameOf = (uid: string): string => {
    const member = memberLookup.get(uid);
    return member ? `${member.firstName} ${member.lastName}` : 'Unbekannt';
  };

  // Each initial pair sits in its own circle; the ring in the card's color keeps
  // overlapping circles apart, so two pairs never read as one word. Plain
  // elements, not a component per person: every list row renders the stack,
  // and lab counts count components.
  return (
    <div className="flex shrink-0 -space-x-1">
      {visible.map((uid) => {
        const member = memberLookup.get(uid);
        return (
          <span key={uid} title={nameOf(uid)} aria-label={nameOf(uid)} className={STACK_AVATAR_CLASS}>
            {member ? getInitials(member.firstName, member.lastName) : '?'}
          </span>
        );
      })}
      {overflow > 0 && (
        <span
          title={userIds.slice(max).map(nameOf).join(', ')}
          aria-label={`${overflow} weitere Mitarbeitende`}
          className={STACK_AVATAR_CLASS}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

/** One circle of the stack, sized for two initials. */
const STACK_AVATAR_CLASS =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground ring-2 ring-card';

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
