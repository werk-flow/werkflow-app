// The workspace holds three sibling clones (AGENTS.md, "Workspace"). Links cross between them, and the
// business and website repositories keep copies of the shared skills. Each repository's own check reads
// only its own tree, so a renamed app heading, a missing clone or a drifted skill copy would pass
// unseen. These rules let docs:check read the siblings without ever editing them.

export const SIBLING_REPOSITORIES = ['werkflow-business', 'werkflow-website'] as const;
export type SiblingRepository = (typeof SIBLING_REPOSITORIES)[number];

/** The sibling whose tree holds a path, given relative to the parent `Code` folder. */
export function siblingOfWorkspacePath(workspacePath: string): SiblingRepository | null {
  const top = workspacePath.split(/[\\/]/)[0];
  return SIBLING_REPOSITORIES.find((sibling) => sibling === top) ?? null;
}

export type MarkdownLink = { line: number; path: string; fragment: string | null };

/** The relative file links of a Markdown text outside fenced code; external and same-file links are skipped. */
export function findMarkdownFileLinks(markdown: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  let fence: string | null = null;
  markdown.split(/\r?\n/).forEach((line, index) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
    if (marker !== undefined) {
      if (fence === null) fence = marker.charAt(0);
      else if (marker.charAt(0) === fence) fence = null;
      return;
    }
    if (fence !== null) return;
    for (const match of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (target === undefined || /^(https?:|mailto:|#)/.test(target)) continue;
      const [path = '', fragment] = target.split('#');
      if (path !== '') links.push({ line: index + 1, path, fragment: fragment ?? null });
    }
  });
  return links;
}

export type SharedSkill = { name: string; consumers: SiblingRepository[] };

/**
 * The shared skill set from the business repository's "Shared skills" table, the one home of
 * which sibling copies which skill. The app keeps its own skills and is not a member.
 */
export function readSharedSkills(skillsDoc: string): SharedSkill[] {
  return [...skillsDoc.matchAll(/^\| ([a-z0-9-]+) \| [^|\n]+\| ([^|\n]+)\|\s*$/gm)].flatMap((match) => {
    const [, name, consumerText = ''] = match;
    const consumers = SIBLING_REPOSITORIES.filter((sibling) =>
      consumerText.toLowerCase().includes(sibling.replace('werkflow-', '')),
    );
    return name === undefined || consumers.length === 0 ? [] : [{ name, consumers }];
  });
}

/** The folders that hold a shared skill, canonical first: each consumer keeps an `.agents` and a `.claude` copy. */
export function skillCopyFolders(skill: SharedSkill): string[] {
  return skill.consumers.flatMap((sibling) =>
    ['.agents', '.claude'].map((tool) => `${sibling}/${tool}/skills/${skill.name}`),
  );
}

export type SkillCopy = { folder: string; files: ReadonlyMap<string, string> };

/** How each copy differs from the first, canonical copy: a missing, extra or changed file. */
export function findSkillCopyDifferences(copies: readonly SkillCopy[]): string[] {
  const [canonical, ...mirrors] = copies;
  if (canonical === undefined) return [];
  return mirrors.flatMap((mirror) => {
    const differences: string[] = [];
    for (const [file, content] of canonical.files) {
      const copied = mirror.files.get(file);
      if (copied === undefined)
        differences.push(`${mirror.folder}/${file} is missing; copy it from ${canonical.folder}`);
      else if (copied !== content)
        differences.push(`${mirror.folder}/${file} differs from ${canonical.folder}/${file}`);
    }
    for (const file of mirror.files.keys()) {
      if (!canonical.files.has(file))
        differences.push(
          `${mirror.folder}/${file} exists only in the copy; ${canonical.folder} is canonical`,
        );
    }
    return differences;
  });
}
