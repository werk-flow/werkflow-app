import { describe, expect, test } from 'bun:test';
import { findSkillMirrorProblems, type SkillTree } from './skill-mirror';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const tree = (skills: Record<string, Record<string, string>>): SkillTree =>
  new Map(
    Object.entries(skills).map(([skill, files]) => [
      skill,
      new Map(Object.entries(files).map(([path, text]) => [path, bytes(text)])),
    ]),
  );

describe('skill mirror', () => {
  test('identical trees and a listed unmirrored skill pass', () => {
    const shared = { unslop: { 'SKILL.md': 'a' } };
    expect(
      findSkillMirrorProblems(tree({ ...shared, 'coderabbit-review': { 'SKILL.md': 'b' } }), tree(shared), [
        'coderabbit-review',
      ]),
    ).toEqual([]);
  });

  test('probe: a drifted file, a missing file, a one-sided file and one-sided skills fail', () => {
    const claude = tree({ unslop: { 'SKILL.md': 'a', 'ref.md': 'r' }, solo: { 'SKILL.md': 's' } });
    const agents = tree({ unslop: { 'SKILL.md': 'b', 'extra.md': 'e' }, other: { 'SKILL.md': 'o' } });
    expect(findSkillMirrorProblems(claude, agents, [])).toEqual([
      'unslop/SKILL.md differs between .claude/skills and .agents/skills',
      'unslop/ref.md is missing from the .agents/skills mirror',
      'unslop/extra.md exists only in .agents/skills; mirror it in .claude/skills',
      'solo exists only in .claude/skills; mirror it or record it as an unmirrored skill in decision 0004',
      'other exists only in .agents/skills; mirror it in .claude/skills',
    ]);
  });
});
