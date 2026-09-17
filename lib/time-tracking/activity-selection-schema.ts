import { z } from 'zod';
import { uuidSchema } from '@/lib/validation/uuid';
import type { TimeActivitySelection } from './types';

const travelRouteSchema = z.enum([
  'company_to_site',
  'home_to_site',
  'site_to_site',
  'site_to_company',
  'other',
  'unspecified',
]);
const travelRoleSchema = z.enum(['driver', 'passenger', 'unspecified']);
export const timeActivitySelectionSchema: z.ZodType<TimeActivitySelection> = z.union([
  z.strictObject({ kind: z.literal('work'), allocationKind: z.literal('job'), jobId: uuidSchema }),
  z.strictObject({ kind: z.literal('work'), allocationKind: z.literal('unallocated'), jobId: z.null() }),
  z.strictObject({ kind: z.literal('callout'), allocationKind: z.literal('job'), jobId: uuidSchema }),
  z.strictObject({ kind: z.literal('callout'), allocationKind: z.literal('unallocated'), jobId: z.null() }),
  z.strictObject({
    kind: z.literal('travel'),
    allocationKind: z.literal('job'),
    jobId: uuidSchema,
    travelRoute: travelRouteSchema,
    travelRole: travelRoleSchema,
  }),
  z.strictObject({
    kind: z.literal('travel'),
    allocationKind: z.literal('unallocated'),
    jobId: z.null(),
    travelRoute: travelRouteSchema,
    travelRole: travelRoleSchema,
  }),
  z.strictObject({ kind: z.literal('break'), allocationKind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('standby'),
    allocationKind: z.literal('none'),
    standbyContext: z.enum(['on_site', 'remote', 'unspecified']),
  }),
  z.strictObject({
    kind: z.literal('internal_activity'),
    allocationKind: z.literal('internal_activity'),
    internalType: z.enum(['internal_work', 'meeting', 'training', 'other']),
  }),
]);

