import { workspacePorts } from './runner/app-port';

/**
 * The organization the local test server releases for WerkFlow KI
 * (scripts/test-server.ts sets AI_ORGANIZATION_IDS to it). One per checkout,
 * from its app port, so two worktrees on the shared stack never seed the same
 * one. Synthetic: the KI journey seeds it in its run's world; no deployed
 * environment reads this file, DEV and PROD take their list from Vercel.
 */
export function testAiOrganizationId(repositoryRoot: string): string {
  return `5a000000-0000-4000-8000-${String(workspacePorts(repositoryRoot).app).padStart(12, '0')}`;
}
