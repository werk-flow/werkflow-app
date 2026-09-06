import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { writeJsonAtomically } from "./file-lock";

const valuesSchema = z
  .object({
    "a1.signupOrganizationCode": z.string().min(1).optional(),
    "a3.personnelRecordId": z.string().min(1).optional(),
    "a6.organizationTimeBaseline": z.number().int().nonnegative().optional(),
    "a7.organizationTimeBaseline": z.number().int().nonnegative().optional(),
    "p1-21.auditJobNumber": z.string().min(1).optional(),
    "gg-01.firstRequestId": z.string().min(1).optional(),
    "p1-03.personnelRecordId": z.string().min(1).optional(),
    "p1-21.canonicalSessionId": z.string().min(1).optional(),
    "p1-23.missingClockObserved": z.boolean().optional(),
    "p1-20.overlapValidationObserved": z.boolean().optional(),
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

function readCheckpoints(
  path: string,
  worldRunId: string,
): z.infer<typeof checkpointSchema> {
  if (!existsSync(path)) return { version: 1, worldRunId, values: {} };
  const checkpoint = checkpointSchema.parse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  if (checkpoint.worldRunId !== worldRunId) {
    throw new Error("Persisted checkpoints belong to a different test world.");
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
