import type { Database } from '@/lib/supabase/database.types';

/** One organization membership of the signed-in user, as the app shell and the server readers share it. */
export type UserOrg = {
  orgId: string;
  name: string;
  uniqueCode: string;
  role: Database['public']['Enums']['org_role'];
  joinedAt: string;
};

/** The states of a join request; the database allows pending -> approved | declined | withdrawn only. */
export type JoinRequestStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

/** The signed-in user's own join request, as the requester sees it. */
export type OwnJoinRequest = {
  id: string;
  organizationId: string;
  organizationName: string;
  status: JoinRequestStatus;
};

/** An open join request of the active organization, as Admin and Büro see it. */
export type PendingJoinRequest = {
  id: string;
  name: string;
  email: string | null;
  requestedAt: string;
};

/** What deleting an organization removes, and whether records under a retention duty forbid the deletion. */
export type OrganizationDeletionScope = {
  members: number;
  openInvites: number;
  clients: number;
  projects: number;
  jobs: number;
  employeeRecords: number;
  documents: number;
  /** Documents whose retention end is today or later, filed or not, the trash included. */
  retainedDocuments: number;
  timeTrackedPeople: number;
  closedPeriods: number;
  payrollExports: number;
  /**
   * Recorded working time, a closed period (owner decision,
   * werk-flow/werkflow-planning#85) or a document inside its retention period
   * (werk-flow/werkflow-planning#283) falls under retention duties, so the
   * organization is not deleted. The name predates the documents: renaming it
   * waits for lib/org/delete-action.ts.
   */
  retainsTimeRecords: boolean;
};
