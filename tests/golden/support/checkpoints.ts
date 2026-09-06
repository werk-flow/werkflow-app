import { resolve } from "node:path";
import {
  readCheckpoint,
  writeCheckpoint,
  type CheckpointValues,
} from "../../../lib/testing/checkpoints";
import { artifactsDirectory, loadWorld } from "./world";

function checkpointPath(): string {
  return resolve(artifactsDirectory(), "checkpoints.json");
}

export function checkpointValue<Key extends keyof CheckpointValues>(
  key: Key,
): CheckpointValues[Key] {
  return readCheckpoint(checkpointPath(), loadWorld().runId, key);
}

export function saveCheckpoint<Key extends keyof CheckpointValues>(
  key: Key,
  value: NonNullable<CheckpointValues[Key]>,
): void {
  writeCheckpoint(checkpointPath(), loadWorld().runId, key, value);
}
