import { z } from 'zod';

import { LAB_METRICS } from './lab-steps';

/**
 * The record one lab step run writes to lab-counts.ndjson in its run directory
 * (docs/technical/performance.md). The recorder imports this module and the
 * step registry only, so the comparison rules and the references can change
 * without changing the test inputs of the lab groups.
 */

/** Bump when the recorder counts differently, so old records and references stop comparing. */
export const LAB_MEASUREMENT_VERSION = 1;

export const LAB_ARCHIVE = 'lab-counts.ndjson';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const labCount = z.number().int().nonnegative();
export const labMetricSchema = z.enum(LAB_METRICS);

/** What makes two step runs comparable. Hardware stays out: no gated count depends on it. */
export const labContextSchema = z
  .object({
    measurementDigest: sha256,
    workloadDigest: sha256,
    browser: z.string().min(1),
    browserVersion: z.string().min(1),
    viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
    cpuThrottle: z.union([z.literal(1), z.literal(4)]),
    role: z.enum(['admin', 'buero', 'employee']),
    backend: z.enum(['local', 'cloud']),
  })
  .strict();

/** One request shape of a step: route GETs by route pattern, background reads by kind, actions by route. */
const labPayloadSchema = z
  .object({
    shape: z.string().min(1),
    requests: z.number().int().positive(),
    encodedBytes: labCount,
    decodedBytes: labCount.nullable(),
    rows: labCount.nullable(),
  })
  .strict();
export type LabPayload = z.infer<typeof labPayloadSchema>;

export const labObservationSchema = z
  .object({
    stepId: z.string().min(1),
    stepVersion: z.number().int().positive(),
    labMeasurementVersion: z.number().int().positive(),
    buildId: z.string().min(1).nullable(),
    context: labContextSchema,
    counts: z.record(labMetricSchema, labCount),
    payloads: z.array(labPayloadSchema),
    /** Informational: from the action to the usable result, on the recorder's clock. Never gated. */
    wallClockMs: z.number().finite().nonnegative(),
    recordedAt: z.string().datetime(),
  })
  .strict();
export type LabObservation = z.infer<typeof labObservationSchema>;
