import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { writeJsonAtomically } from '../runner/file-lock';
import { uuidSchema } from '../../validation/uuid';

// World-scoped seed-or-reuse values: the layout fixture and the measured performance profile.
// Tests never hand values to each other through this file (testing.md, "Spec checklist").
const valuesSchema = z
  .object({
    'layout.details': z
      .object({
        clientId: uuidSchema,
        requestId: uuidSchema,
        projectId: uuidSchema,
        projectNumber: z.string().min(1),
        jobId: uuidSchema,
        jobNumber: z.string().min(1),
        nestedJobNumber: z.string().min(1),
        equipmentNumber: z.string().min(1),
        caseNumber: z.string().min(1),
      })
      .strict()
      .optional(),
    // Step 2 performance profile: the seeded window and the job whose assignee the list must render.
    'performance.typicalProfile': z
      .object({
        windowFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        assignedJobNumber: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

const checkpointSchema = z
  .object({
    version: z.literal(1),
    worldRunId: z.string().min(1),
    values: valuesSchema,
  })
  .strict();

export type CheckpointValues = z.infer<typeof valuesSchema>;
type CheckpointKey = keyof CheckpointValues;

function readCheckpoints(path: string, worldRunId: string): z.infer<typeof checkpointSchema> {
  if (!existsSync(path)) return { version: 1, worldRunId, values: {} };
  const checkpoint = checkpointSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  if (checkpoint.worldRunId !== worldRunId) {
    throw new Error('Persisted checkpoints belong to a different test world.');
  }
  return checkpoint;
}

export function readCheckpoint<Key extends CheckpointKey>(
  path: string,
  worldRunId: string,
  key: Key,
): CheckpointValues[Key] {
  return readCheckpoints(path, worldRunId).values[key];
}

export function writeCheckpoint<Key extends CheckpointKey>(
  path: string,
  worldRunId: string,
  key: Key,
  value: NonNullable<CheckpointValues[Key]>,
): void {
  const checkpoint = readCheckpoints(path, worldRunId);
  const validated = checkpointSchema.parse({
    ...checkpoint,
    values: { ...checkpoint.values, [key]: value },
  });
  mkdirSync(dirname(path), { recursive: true });
  writeJsonAtomically(path, validated);
}
