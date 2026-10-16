import type { MemberListEntry } from '@/lib/members/profile-name';

/** A calendar member as the page loads it; the one display-name rule for every view. */
export type CalendarMember = MemberListEntry;

export function memberDisplayName(member: CalendarMember): string {
  return member.first_name || member.last_name
    ? `${member.first_name || ''} ${member.last_name || ''}`.trim()
    : member.email;
}
