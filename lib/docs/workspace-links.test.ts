import { describe, expect, test } from 'bun:test';
import {
  findMarkdownFileLinks,
  findSkillCopyDifferences,
  readSharedSkills,
  resolveWorkspaceLink,
  siblingOfWorkspacePath,
  skillCopyFolders,
  workspaceRootOf,
} from './workspace-links';

describe('workspace layout', () => {
  const mainCheckout = { appRoot: '/home/dev/Code/werkflow-app', workspaceRoot: '/home/dev/Code' };
  const t3Worktree = {
    appRoot: '/home/dev/.t3/worktrees/werkflow-app/t3-b04b9a88',
    workspaceRoot: '/home/dev/Code',
  };
  const renamedWorktree = { appRoot: '/home/dev/Code/werkflow-app-fix', workspaceRoot: '/home/dev/Code' };

  test('the workspace is the parent of the main checkout, wherever the worktree sits', () => {
    expect(workspaceRootOf(mainCheckout.appRoot, '/home/dev/Code/werkflow-app/.git')).toBe('/home/dev/Code');
    expect(workspaceRootOf(t3Worktree.appRoot, '/home/dev/Code/werkflow-app/.git')).toBe('/home/dev/Code');
    expect(workspaceRootOf(t3Worktree.appRoot, null)).toBe('/home/dev/.t3/worktrees/werkflow-app');
  });

  test('an app link out of a worktree lands in the sibling beside the main checkout', () => {
    for (const layout of [mainCheckout, t3Worktree, renamedWorktree]) {
      expect(
        resolveWorkspaceLink(
          layout,
          `${layout.appRoot}/docs/README.md`,
          '../../werkflow-business/docs/offer.md',
        ),
      ).toBe('/home/dev/Code/werkflow-business/docs/offer.md');
      expect(resolveWorkspaceLink(layout, `${layout.appRoot}/docs/README.md`, 'technical/testing.md')).toBe(
        `${layout.appRoot}/docs/technical/testing.md`,
      );
    }
  });

  test('a sibling link into the app lands in the checkout under check, not the main checkout', () => {
    for (const layout of [mainCheckout, t3Worktree, renamedWorktree]) {
      expect(
        resolveWorkspaceLink(
          layout,
          '/home/dev/Code/werkflow-business/AGENTS.md',
          '../werkflow-app/AGENTS.md',
        ),
      ).toBe(`${layout.appRoot}/AGENTS.md`);
      expect(
        resolveWorkspaceLink(
          layout,
          '/home/dev/Code/werkflow-business/AGENTS.md',
          '../werkflow-website/AGENTS.md',
        ),
      ).toBe('/home/dev/Code/werkflow-website/AGENTS.md');
    }
  });

  test('a worktree inside the main checkout keeps its own files', () => {
    const nested = { appRoot: '/home/dev/Code/werkflow-app/.worktrees/fix', workspaceRoot: '/home/dev/Code' };
    expect(resolveWorkspaceLink(nested, `${nested.appRoot}/AGENTS.md`, 'docs/README.md')).toBe(
      `${nested.appRoot}/docs/README.md`,
    );
    expect(
      resolveWorkspaceLink(nested, `${nested.appRoot}/AGENTS.md`, '../werkflow-business/AGENTS.md'),
    ).toBe('/home/dev/Code/werkflow-business/AGENTS.md');
  });
});

describe('workspace links', () => {
  test('a workspace path belongs to the sibling at its top folder', () => {
    expect(siblingOfWorkspacePath('werkflow-business/docs/offer.md')).toBe('werkflow-business');
    expect(siblingOfWorkspacePath('werkflow-website\\AGENTS.md')).toBe('werkflow-website');
    expect(siblingOfWorkspacePath('werkflow-app/AGENTS.md')).toBeNull();
  });

  test('file links keep their line and fragment; external, same-file and fenced links are skipped', () => {
    const markdown = [
      'Read [the app](../werkflow-app/AGENTS.md) and [a heading](../../werkflow-app/docs/x.md#the-rule).',
      'See [the site](https://werk-flow.app), [mail](mailto:a@b.c) and [below](#below).',
      '```md',
      '[an example](../werkflow-app/missing.md)',
      '```',
      'After [the fence](docs/README.md).',
    ].join('\n');
    expect(findMarkdownFileLinks(markdown)).toEqual([
      { line: 1, path: '../werkflow-app/AGENTS.md', fragment: null },
      { line: 1, path: '../../werkflow-app/docs/x.md', fragment: 'the-rule' },
      { line: 6, path: 'docs/README.md', fragment: null },
    ]);
  });
});

describe('shared skill copies', () => {
  const skillsDoc = [
    '| Skill | Canonical source | Consumers |',
    '| --- | --- | --- |',
    '| unslop | [Business skill](../.agents/skills/unslop/SKILL.md) | Business and website |',
    '| frontend-design | Anthropic upstream | Website only |',
  ].join('\n');

  test('the business skill table names each skill and the siblings that copy it', () => {
    expect(readSharedSkills(skillsDoc)).toEqual([
      { name: 'unslop', consumers: ['werkflow-business', 'werkflow-website'] },
      { name: 'frontend-design', consumers: ['werkflow-website'] },
    ]);
    expect(
      skillCopyFolders({ name: 'unslop', consumers: ['werkflow-business', 'werkflow-website'] }),
    ).toEqual([
      'werkflow-business/.agents/skills/unslop',
      'werkflow-business/.claude/skills/unslop',
      'werkflow-website/.agents/skills/unslop',
      'werkflow-website/.claude/skills/unslop',
    ]);
  });

  test('identical copies pass; a changed, missing or extra file in a copy fails against the canonical one', () => {
    const canonical = { folder: 'b/.agents/skills/unslop', files: new Map([['SKILL.md', 'rules']]) };
    expect(
      findSkillCopyDifferences([canonical, { ...canonical, folder: 'w/.claude/skills/unslop' }]),
    ).toEqual([]);
    expect(
      findSkillCopyDifferences([
        canonical,
        { folder: 'w/.agents/skills/unslop', files: new Map([['SKILL.md', 'edited']]) },
        { folder: 'w/.claude/skills/unslop', files: new Map([['notes.md', 'x']]) },
      ]),
    ).toEqual([
      'w/.agents/skills/unslop/SKILL.md differs from b/.agents/skills/unslop/SKILL.md',
      'w/.claude/skills/unslop/SKILL.md is missing; copy it from b/.agents/skills/unslop',
      'w/.claude/skills/unslop/notes.md exists only in the copy; b/.agents/skills/unslop is canonical',
    ]);
  });
});
