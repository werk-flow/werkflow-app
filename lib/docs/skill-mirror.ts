// Claude Code reads skills from .claude/skills and Codex from .agents/skills. The two trees are
// kept byte for byte by hand, so a skill edited in one tree only would steer the two agents
// differently. Skills listed as unmirrored exist only under .claude.

/** One skill tree: skill name to its files, keyed by the path inside the skill folder. */
export type SkillTree = ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>;

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/** Every difference between the .claude and .agents skill trees. */
export function findSkillMirrorProblems(
  claude: SkillTree,
  agents: SkillTree,
  unmirrored: readonly string[],
): string[] {
  const problems: string[] = [];
  for (const [skill, files] of claude) {
    const mirror = agents.get(skill);
    if (mirror === undefined) {
      if (!unmirrored.includes(skill))
        problems.push(
          `${skill} exists only in .claude/skills; mirror it or record it as an unmirrored skill in decision 0004`,
        );
      continue;
    }
    for (const [path, bytes] of files) {
      const copy = mirror.get(path);
      if (copy === undefined) problems.push(`${skill}/${path} is missing from the .agents/skills mirror`);
      else if (!sameBytes(bytes, copy))
        problems.push(`${skill}/${path} differs between .claude/skills and .agents/skills`);
    }
    for (const path of mirror.keys()) {
      if (!files.has(path))
        problems.push(`${skill}/${path} exists only in .agents/skills; mirror it in .claude/skills`);
    }
  }
  for (const skill of agents.keys()) {
    if (!claude.has(skill))
      problems.push(`${skill} exists only in .agents/skills; mirror it in .claude/skills`);
  }
  return problems;
}
