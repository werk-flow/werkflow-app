import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead, logReadFailure } from '@/lib/data/read-request-cache';
import { readJobAssignmentOfUser, readOrganizationJob } from '@/lib/jobs/job-access-reads';
import { formatProfileName } from '@/lib/members/profile-name';
import { acceptedScopeSchema } from '@/lib/offers/accepted-scope';
import { resolveActionContext } from '@/lib/org/action-context';
import { workLeadTargetSchema, type WorkLeadTarget } from '@/lib/projects/work-lead-types';
import { isWorkLeadOf } from '@/lib/responsibilities/work-lead';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { fieldScopeFrom } from './field-scope';
import type { FieldScopeOrder, JobOrderPresence, OfferWork, WorkOrder } from './types';

// The reads of orders (get_work_orders, get_work_scope and get_offer_order in
// supabase/migrations/20270701160000_convert_an_accepted_offer_into_work_once.sql).
// Only the server reads the order tables, with the service role, after it
// has established who may read what: the office reads an order with its
// prices; an assigned field worker and the project lead read its scope only.

type WorkTarget = WorkLeadTarget;

const personSchema = z
  .object({ firstName: z.string().nullable(), lastName: z.string().nullable(), email: z.string().nullable() })
  .nullable();

const ordersSchema = z.array(
  z.object({
    id: uuidSchema,
    offerId: uuidSchema,
    offerNumber: z.string(),
    revision: z.number().int().positive(),
    acceptedByName: z.string(),
    acceptedOn: z.iso.date(),
    convertedAt: z.string(),
    convertedBy: personSchema,
    scope: acceptedScopeSchema,
    netCents: z.number().int(),
    taxCents: z.number().int(),
    grossCents: z.number().int(),
  }),
);

const offerWorkSchema = z
  .object({
    kind: z.enum(['job', 'project']),
    workId: uuidSchema,
    number: z.string(),
    title: z.string(),
    projectNumber: z.string().nullable(),
  })
  .nullable();

/** The orders of a job or project with their prices, for Admin and Büro. */
export async function readWorkOrders(rawTarget: WorkTarget): Promise<ActionResult<{ orders: WorkOrder[] }>> {
  const target = workLeadTargetSchema.safeParse(rawTarget);
  if (!target.success) return { success: false, error: 'invalid_input' };
  const caller = await resolveActionContext();
  if (!caller.success) return caller;
  if (!caller.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const { data, error } = await createSupabaseAdminClient().rpc('get_work_orders', {
    p_organization_id: caller.context.orgId,
    p_kind: target.data.targetType,
    p_work_id: target.data.targetId,
  });
  const orders = ordersSchema.safeParse(data);
  if (error || !orders.success) {
    logReadFailure('readWorkOrders: get_work_orders failed', error);
    return { success: false, error: 'load_failed' };
  }
  return {
    success: true,
    orders: orders.data.map(({ netCents, taxCents, grossCents, convertedBy, ...order }) => ({
      ...order,
      convertedBy: convertedBy
        ? formatProfileName({
            first_name: convertedBy.firstName,
            last_name: convertedBy.lastName,
            email: convertedBy.email,
          })
        : null,
      totals: { netCents, taxCents, grossCents },
    })),
  };
}

/**
 * Whether the caller may read the work's scope: Admin and Büro; for a job, an
 * employee assigned to it; for either, its „Projektleitung“. `load_failed`
 * when a fact could not be read, which never counts as access.
 */
async function mayReadScope(
  context: { orgId: string; userId: string; isManagerOrAbove: boolean },
  target: WorkTarget,
): Promise<boolean | 'load_failed'> {
  const admin = createSupabaseAdminClient();
  const work =
    target.targetType === 'job'
      ? await readOrganizationJob(context.orgId, target.targetId)
      : await loggedRead(
          'readWorkScope: projects read failed',
          admin
            .from('projects')
            .select('id')
            .eq('organization_id', context.orgId)
            .eq('id', target.targetId)
            .maybeSingle(),
        );
  if (work.error) return 'load_failed';
  if (!work.data) return false;
  if (context.isManagerOrAbove) return true;
  if (target.targetType === 'job') {
    const assignment = await readJobAssignmentOfUser(context.orgId, target.targetId, context.userId);
    if (assignment.error) return 'load_failed';
    if (assignment.data) return true;
  }
  return isWorkLeadOf(context, target);
}

/**
 * The scope of a job or project for the field and the project lead: the
 * orders bound to it and, for a job, to its project, as text, quantity and
 * unit. The answer's type holds no price.
 */
export async function readWorkScope(
  rawTarget: WorkTarget,
): Promise<ActionResult<{ scope: FieldScopeOrder[] }>> {
  const target = workLeadTargetSchema.safeParse(rawTarget);
  if (!target.success) return { success: false, error: 'invalid_input' };
  const caller = await resolveActionContext();
  if (!caller.success) return caller;
  const allowed = await mayReadScope(caller.context, target.data);
  if (allowed === 'load_failed') return { success: false, error: 'load_failed' };
  if (!allowed) return { success: false, error: 'not_authorized' };
  const { data, error } = await createSupabaseAdminClient().rpc('get_work_scope', {
    p_organization_id: caller.context.orgId,
    p_kind: target.data.targetType,
    p_work_id: target.data.targetId,
  });
  if (error) {
    logReadFailure('readWorkScope: get_work_scope failed', error);
    return { success: false, error: 'load_failed' };
  }
  try {
    return { success: true, scope: fieldScopeFrom(data) };
  } catch (parseError) {
    logReadFailure('readWorkScope: malformed scope', parseError);
    return { success: false, error: 'load_failed' };
  }
}

/** The work the organization's offer became, for the offer's page; null before its conversion. Throws on a failed read. */
export async function readOfferWork(organizationId: string, offerId: string): Promise<OfferWork | null> {
  const { data, error } = await createSupabaseAdminClient().rpc('get_offer_order', {
    p_organization_id: organizationId,
    p_offer_id: offerId,
  });
  const work = offerWorkSchema.safeParse(data);
  if (error || !work.success) throw new Error('offer_order_read_failed');
  if (!work.data) return null;
  const { workId, ...rest } = work.data;
  return { ...rest, id: workId };
}

/** A job's orders with prices; a job the job read found without an order reads none. */
export async function readJobOrders(
  jobId: string,
  presence: JobOrderPresence | undefined,
): Promise<ActionResult<{ orders: WorkOrder[] }>> {
  return presence?.job
    ? readWorkOrders({ targetType: 'job', targetId: jobId })
    : { success: true, orders: [] };
}

/** A job's scope for the field; a job whose work the job read found without an order reads none. */
export async function readJobScope(
  jobId: string,
  presence: JobOrderPresence | undefined,
): Promise<ActionResult<{ scope: FieldScopeOrder[] }>> {
  return presence ? readWorkScope({ targetType: 'job', targetId: jobId }) : { success: true, scope: [] };
}
