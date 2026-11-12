import { parseListPage } from '@/lib/ui/list-pagination';
import { z } from '@/lib/zod';
import {
  SUPPORT_QUEUE_BUCKET_FILTERS,
  SUPPORT_QUEUE_STATUS_FILTERS,
  type SupportQueueQuery,
} from './schemas';

/** URL state of support's queue; an unknown value falls back to the first page of the open reports. */
export function parseSupportQueueQuery(
  params: Record<string, string | string[] | undefined>,
): SupportQueueQuery {
  const single = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : undefined;
  };
  return {
    status: z.enum(SUPPORT_QUEUE_STATUS_FILTERS).catch('offen').parse(single('status')),
    bucket: z.enum(SUPPORT_QUEUE_BUCKET_FILTERS).catch('alle').parse(single('einordnung')),
    page: Math.min(parseListPage(single('seite')), 100_000),
  };
}
