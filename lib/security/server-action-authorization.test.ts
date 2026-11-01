import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

import {
  actionReach,
  CONTEXT_ROOTS,
  CONTEXT_WRAPPERS,
  couldContainServerDirective,
  exportedActions,
  guardOrder,
  IDENTITY_ONLY_ACTIONS,
  listApplicationSources,
  localFunctions,
  localReach,
  moduleGuards,
  OWNER_MODULE,
  repositoryRoot,
  ROOT_OWNERS,
  unguardedActions,
} from '@/lib/testing/server-action-inventory';

// Tier 1 and 2 guard for SI-025. Every exported function of a 'use server'
// module is a public POST endpoint. It establishes the caller's organization
// context through the one owner module, lib/org/action-context.ts, directly
// or through a named wrapper that this file proves is built on it. An action
// that needs no organization (the caller's own account, a step before any
// membership) is listed with its reason and reaches the session identity. The
// check is called unconditionally and its failure returns or throws before the
// first admin client, rpc or write ("Order" in
// lib/testing/server-action-inventory.ts, which also holds the owner functions,
// the named wrappers and the reviewed identity-only actions). This proves the
// place of the right kind of check, not its correctness; the boundary tests own that.

test('module and inline Server Actions establish organization context or are reviewed identity-only actions', () => {
  const unguarded: string[] = [];
  const existing = new Set<string>();
  const contextGuarded = new Set<string>();
  for (const file of listApplicationSources()) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    // Most files contain no directive. Keep escaped spellings eligible for AST
    // inspection without parsing huge generated types on every unit run.
    if (!couldContainServerDirective(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const actions = exportedActions(file, source);
    for (const action of actions) {
      existing.add(`${file}#${action.name}`);
      if (actionReach(source, action).context) contextGuarded.add(`${file}#${action.name}`);
    }
    unguarded.push(...unguardedActions(file, source, actions));
  }
  expect(
    unguarded,
    'call resolveActionContext or resolveActionContextFor (lib/org/action-context.ts) or a named wrapper unconditionally, and return or throw on its failure before the first admin client, rpc or write',
  ).toEqual([]);
  expect(
    Object.keys(IDENTITY_ONLY_ACTIONS).filter((key) => !existing.has(key) || contextGuarded.has(key)),
    'stale identity-only entries: the action is gone or now has an organization check',
  ).toEqual([]);
});

test('every named wrapper is built on the owner module', () => {
  const unbuilt: string[] = [];
  for (const [name, file] of Object.entries(CONTEXT_WRAPPERS)) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const others = new Set([
      ...CONTEXT_ROOTS,
      ...Object.keys(CONTEXT_WRAPPERS).filter((other) => other !== name),
    ]);
    if (localReach(source, others).get(name)?.context !== true) unbuilt.push(`${file}#${name}`);
    // A wrapper keeps the order rule itself: the admin client only after its own check.
    const wrapper = localFunctions(source).find((local) => local.name === name);
    const order = wrapper && guardOrder(wrapper.body, moduleGuards(source, others, new Set()));
    if (order?.problem !== undefined) unbuilt.push(`${file}#${name}: ${order.problem}`);
  }
  expect(unbuilt, `a wrapper must call a root of ${OWNER_MODULE} or another wrapper`).toEqual([]);
  for (const [root, file] of Object.entries(ROOT_OWNERS)) {
    expect(readFileSync(resolve(repositoryRoot, file), 'utf8')).toContain(`export async function ${root}(`);
  }
});
