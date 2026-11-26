/** The same line shape `loadEnvLocal` accepts; other lines are comments or blank. */
export function parseEnvironmentFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const [, key, rawValue] = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/) ?? [];
    if (key === undefined || rawValue === undefined) continue;
    values[key] = rawValue.trim().replace(/^["']|["']$/g, '');
  }
  return values;
}
