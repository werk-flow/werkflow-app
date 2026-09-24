/** A calendar member as the page loads it; the one display-name rule for every view. */
export interface CalendarMember {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

export function memberDisplayName(member: CalendarMember): string {
  return member.first_name || member.last_name ? `${member.first_name || ''} ${member.last_name || ''}`.trim() : member.email;
}
