// Isolated stand-in for `@/lib/members/actions` in the member role contract:
// the menus get their role change as a prop, and removal is not under test.
import type { RemoveMemberResult } from '@/lib/members/actions';

export async function removeMember(): Promise<RemoveMemberResult> {
  return { success: false, error: 'unexpected_error' };
}
