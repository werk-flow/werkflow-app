export type SpawnFailureResult = {
  error?: Error;
  status: number | null;
  stderr: string | null;
};

export function getSpawnFailureDetail(
  result: SpawnFailureResult,
  fallback: string,
): string {
  return result.stderr?.trim() || result.error?.message || fallback;
}
