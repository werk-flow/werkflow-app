'use server';

import type { ActionResult } from '@/lib/action-result';
import { requireServiceManager } from '@/lib/service-cases/manager-context';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

import { readServiceReportDelivery } from './delivery';
import { readCompletedVisitPage } from './reads';
import type { CompletedVisitPage, ServiceReportDelivery } from './types';

// The completed-visit list's read and a report's deliveries, apart from the
// report action, so the page and the background read registry load no filing
// or rendering code.

const pageSchema = z.object({ page: z.number().int().min(1).max(1_000_000) });

/** One page of completed visits with their latest report; Admin and Büro only. */
export async function getCompletedVisitPage(input: {
  page: number;
}): Promise<ActionResult<{ page: CompletedVisitPage }>> {
  const parsed = pageSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireServiceManager();
  if ('success' in context) return context;
  return readCompletedVisitPage(context, parsed.data.page);
}

const reportSchema = z.object({ reportId: uuidSchema });

/** „Versand“ of one report: its deliveries and what the email form proposes; Admin and Büro only. */
export async function getServiceReportDelivery(input: {
  reportId: string;
}): Promise<ActionResult<{ delivery: ServiceReportDelivery }>> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireServiceManager();
  if ('success' in context) return context;
  return readServiceReportDelivery(context, parsed.data.reportId);
}
