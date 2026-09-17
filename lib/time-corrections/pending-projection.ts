import type { SupabaseClient } from "@supabase/supabase-js";

import type { EffectiveResponsibilityHolder } from "@/lib/responsibilities/resolution";
import { canHolderApproveTarget } from "@/lib/responsibilities/resolution";
import type { Database } from "@/lib/supabase/database.types";
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from "@/lib/supabase/query-batches";
import type { OrgRole } from "@/lib/time-tracking/types";

import { isTimeCorrectionSnapshot, type TimeCorrectionSnapshot } from "./types";

/**
 * Pending-only read behind the provisional time projection (Step 2, PF-19).
 * This module takes the admin client as a parameter and creates none, so
 * unit tests exercise the real query plan through a fake port.
 * Every calendar and time read used to load the organization's 300 newest
 * correction requests with names and memberships and filter them in memory.
 * This module pushes the pending status and the subject filter into the
 * query and loads only the current revisions and sources of those requests.
 * The visibility rule is the one `getTimeCorrectionRequests` applies: a
 * manager sees every request, an employee sees requests they raised, are the
 * subject of, or may review as the effective time-approval holder.
 */

type Tables = Database["public"]["Tables"];
export type PendingRequestRow = Pick<
  Tables["time_correction_requests"]["Row"],
  "id" | "kind" | "status" | "subject_user_id" | "requested_by" | "current_revision" | "updated_at"
>;
export type RevisionRow = Pick<
  Tables["time_correction_request_revisions"]["Row"],
  "request_id" | "revision" | "proposed_snapshot"
>;
export type SourceRow = Tables["time_correction_request_sources"]["Row"];

const PENDING_CORRECTION_STATUSES = ["submitted", "clarification_required"] as const;
/** Read completely up to the shared bound; overflow must not appear as an empty calendar. */
export const PENDING_CORRECTION_LIMIT = LIST_ROW_CAP;

/** Four logical reads. Their adapters page rows and bound ID batches. */
export type PendingProjectionPort = {
  listPendingRequests: (input: {
    organizationId: string;
    subjectUserId?: string | undefined;
    limit: number;
  }) => Promise<PendingRequestRow[] | null>;
  listMemberRoles: (input: {
    organizationId: string;
    userIds: readonly string[];
  }) => Promise<Array<{ user_id: string; role: string }> | null>;
  listCurrentRevisions: (input: {
    organizationId: string;
    requests: ReadonlyArray<{ id: string; currentRevision: number }>;
  }) => Promise<RevisionRow[] | null>;
  listSources: (input: {
    organizationId: string;
    requestIds: readonly string[];
  }) => Promise<SourceRow[] | null>;
};

export function createPendingProjectionPort(
  admin: SupabaseClient<Database>,
): PendingProjectionPort {
  return {
    listPendingRequests: async ({ organizationId, subjectUserId, limit }) => {
      const { data, error } = await readCompleteRows((from, to) => {
      let query = admin
        .from("time_correction_requests")
        .select("id, kind, status, subject_user_id, requested_by, current_revision, updated_at")
        .eq("organization_id", organizationId)
        .in("status", [...PENDING_CORRECTION_STATUSES])
        .order("created_at", { ascending: false }).order("id")
        .range(from, to);
      if (subjectUserId) query = query.eq("subject_user_id", subjectUserId);
      return query;
      }, limit);
      return error ? null : data;
    },
    listMemberRoles: async ({ organizationId, userIds }) => {
      const { data, error } = await readInBatches(userIds, (batch) => admin
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", organizationId)
        .in("user_id", [...batch]).order("user_id"));
      return error ? null : data;
    },
    listCurrentRevisions: async ({ organizationId, requests }) => {
      const revisionByRequest = new Map(requests.map((request) => [request.id, request.currentRevision]));
      const { data, error } = await readInBatches(requests.map((request) => request.id), (batch) => readCompleteRows((from, to) => admin
        .from("time_correction_request_revisions")
        .select("request_id, revision, proposed_snapshot")
        .eq("organization_id", organizationId)
        // Exact (request, revision) pairs: two independent `in` filters would read
        // the cross product and could spend the row cap on rows nobody asked for.
        .or(batch.map((id) => {
          const revision = revisionByRequest.get(id);
          if (revision === undefined) throw new Error("Pending correction revision is missing from its requested batch.");
          return `and(request_id.eq.${id},revision.eq.${revision})`;
        }).join(","))
        .order("request_id").order("revision").range(from, to), LIST_ROW_CAP));
      return error || data.length > LIST_ROW_CAP ? null : data;
    },
    listSources: async ({ organizationId, requestIds }) => {
      const { data, error } = await readInBatches(requestIds, (batch) => readCompleteRows((from, to) => admin
        .from("time_correction_request_sources")
        .select("*")
        .eq("organization_id", organizationId)
        .in("request_id", [...batch])
        .order("request_id").order("revision").order("ordinal").range(from, to), LIST_ROW_CAP));
      return error || data.length > LIST_ROW_CAP ? null : data;
    },
  };
}

export type PendingCorrectionRequest = {
  id: string;
  kind: PendingRequestRow["kind"];
  currentRevision: number;
  updatedAt: string;
  subjectUserId: string;
  proposedSnapshot: TimeCorrectionSnapshot;
};

export type PendingCorrectionProjectionInput = {
  organizationId: string;
  /** Restricts the projection to one subject; employees always pass their own id. */
  subjectUserId?: string | undefined;
  caller: {
    userId: string;
    role: OrgRole;
    /** The effective time-approval holder for the caller, when any. */
    holder: EffectiveResponsibilityHolder | null;
  };
};

function isOrgRole(value: string): value is OrgRole {
  return value === "admin" || value === "buero" || value === "employee";
}

/**
 * Loads the pending requests visible to the caller with their current
 * revisions and sources. Returns null when a read failed; an empty result is
 * a successful "nothing pending".
 */
export async function loadPendingCorrectionProjection(
  port: PendingProjectionPort,
  input: PendingCorrectionProjectionInput,
): Promise<{ requests: PendingCorrectionRequest[]; sources: SourceRow[] } | null> {
  const { organizationId, subjectUserId, caller } = input;
  if (caller.role === "employee" && subjectUserId && subjectUserId !== caller.userId && !caller.holder) {
    return { requests: [], sources: [] };
  }
  const rows = await port.listPendingRequests({
    organizationId,
    subjectUserId,
    limit: PENDING_CORRECTION_LIMIT,
  });
  if (!rows) return null;

  let visible = rows;
  if (caller.role === "employee") {
    const own = rows.filter(
      (row) => row.requested_by === caller.userId || row.subject_user_id === caller.userId,
    );
    const holder = caller.holder;
    if (!holder) {
      visible = own;
    } else {
      const others = rows.filter((row) => !own.includes(row));
      const roles = others.length
        ? await port.listMemberRoles({
            organizationId,
            userIds: [...new Set(others.map((row) => row.subject_user_id))],
          })
        : [];
      if (!roles) return null;
      const roleByUser = new Map(roles.map((member) => [member.user_id, member.role]));
      visible = rows.filter((row) => {
        if (own.includes(row)) return true;
        const targetRole = roleByUser.get(row.subject_user_id);
        return Boolean(
          targetRole && isOrgRole(targetRole) &&
            canHolderApproveTarget(holder, row.subject_user_id, targetRole),
        );
      });
    }
  }
  if (visible.length === 0) return { requests: [], sources: [] };

  const [revisions, sources] = await Promise.all([
    port.listCurrentRevisions({
      organizationId,
      requests: visible.map((row) => ({ id: row.id, currentRevision: row.current_revision })),
    }),
    port.listSources({ organizationId, requestIds: visible.map((row) => row.id) }),
  ]);
  if (!revisions || !sources) return null;
  const revisionByKey = new Map(
    revisions.map((revision) => [`${revision.request_id}:${revision.revision}`, revision]),
  );
  const requests: PendingCorrectionRequest[] = [];
  for (const row of visible) {
    const revision = revisionByKey.get(`${row.id}:${row.current_revision}`);
    if (!revision || !isTimeCorrectionSnapshot(revision.proposed_snapshot)) return null;
    requests.push({
      id: row.id,
      kind: row.kind,
      currentRevision: row.current_revision,
      updatedAt: row.updated_at,
      subjectUserId: row.subject_user_id,
      proposedSnapshot: revision.proposed_snapshot,
    });
  }
  return { requests, sources };
}
