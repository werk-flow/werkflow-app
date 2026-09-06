export function findSliceRecordProblems({
  paths,
  sliceIds,
}: {
  paths: readonly string[];
  sliceIds: ReadonlySet<string>;
}): string[] {
  const problems: string[] = [];
  const records = new Map<string, string>();

  for (const path of paths) {
    const fileName = path.split("/").pop() ?? "";
    const sliceId = fileName.match(/^(p1-\d{2}a?)-/)?.[1]?.toUpperCase();
    if (!path.startsWith("plans/phase-1/slices/")) {
      if (sliceId) {
        problems.push(`${path} is a per-slice document outside plans/phase-1/slices/`);
      }
      continue;
    }
    if (!sliceId || !sliceIds.has(sliceId)) {
      problems.push(`${path} does not name a slice in the roadmap`);
      continue;
    }
    if (fileName.includes("implementation-plan")) {
      problems.push(`${path} must use the slice record as its only plan`);
    }
    const existing = records.get(sliceId);
    if (existing) {
      problems.push(`${sliceId} has two records: ${existing} and ${path}`);
    } else {
      records.set(sliceId, path);
    }
  }

  return problems;
}
