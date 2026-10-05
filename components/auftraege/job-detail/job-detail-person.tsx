import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getInitials } from '@/lib/members/profile-name';
import { getProfileAvatarUrl } from '@/lib/profile-avatar';

export type SessionPerson = {
  firstName: string | null;
  lastName: string | null;
  email?: string | null;
  avatarPath?: string | null;
};

export function getSessionPersonName(person?: SessionPerson | null): string {
  if (!person) return 'Mitarbeiter';
  return [person.firstName, person.lastName].filter(Boolean).join(' ') || person.email || 'Mitarbeiter';
}

export function PersonAvatar({
  person,
  className,
  fallbackClassName,
}: {
  person?: SessionPerson | null | undefined;
  className?: string;
  fallbackClassName?: string;
}) {
  return (
    <Avatar className={className}>
      <AvatarImage src={getProfileAvatarUrl(person?.avatarPath) ?? undefined} />
      <AvatarFallback className={fallbackClassName}>
        {getInitials(person?.firstName ?? null, person?.lastName ?? null)}
      </AvatarFallback>
    </Avatar>
  );
}
