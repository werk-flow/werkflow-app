import type { ActionResult } from '@/lib/action-result';
import { resolveActionContext, type ActionContext } from '@/lib/org/action-context';

export type AuthContext = ActionContext;

type AuthResult = ActionResult<{ context: AuthContext }>;

/**
 * The caller context of the jobs, projects and clients actions and of most
 * domain guards. A named wrapper of `resolveActionContext`, which owns the
 * identity, organization and role resolution.
 */
export async function authenticateAndAuthorize(): Promise<AuthResult> {
  return resolveActionContext();
}
