export function migrationVersionFromFileName(fileName: string): string | null {
  return /^(\d{14})_.+\.sql$/.exec(fileName)?.[1] ?? null;
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  }
  return [...duplicates].sort();
}

export function compareMigrationVersions(input: {
  committed: readonly string[];
  remote: readonly string[];
}): string[] {
  const committed = new Set(input.committed);
  const remote = new Set(input.remote);
  const missing = [...committed]
    .filter((version) => !remote.has(version))
    .sort();
  const unexpected = [...remote]
    .filter((version) => !committed.has(version))
    .sort();
  const duplicates = duplicateValues(input.remote);
  const problems: string[] = [];
  if (missing.length > 0) {
    problems.push(`Missing remote migration versions: ${missing.join(', ')}.`);
  }
  if (unexpected.length > 0) {
    problems.push(
      `Unexpected remote migration versions: ${unexpected.join(', ')}.`,
    );
  }
  if (duplicates.length > 0) {
    problems.push(
      `Duplicate remote migration versions: ${duplicates.join(', ')}.`,
    );
  }
  return problems;
}
