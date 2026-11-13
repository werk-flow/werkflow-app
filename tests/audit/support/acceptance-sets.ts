import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { TestWorld } from '../../golden/support/world';
import type { AcceptanceSet, CaptureSpec } from './acceptance-rounds';
import type { SurfaceDestination } from './surface-routes';

/**
 * The open sets of rendered acceptance (docs/technical/standards-audit.md,
 * "Rendered design acceptance"): the screens a change shows the owner,
 * captured by the focused run `bun run test:audit:focused --grep "@ACCEPT <set>"`
 * with the fixture that owns login and readiness. Each set is one file under
 * acceptance-sets/, named after its id, with the records it seeds, so two
 * changes that add sets touch different files (werk-flow/werkflow-planning#359).
 * A set stays while the record or the owner review that cites it is open;
 * delete its file when that closes (the images stay in their run directory).
 * Together they are the group `audit:visual:acceptance:sets`; the rounds over
 * the whole inventory live in acceptance-rounds.ts.
 */

/** A capture of an open set, which may open a record it seeds instead of its route's layout record. */
type SetCapture = CaptureSpec & {
  destination?: (world: TestWorld) => Promise<SurfaceDestination>;
  /** A dialog that pictures the page as it opens, such as the report's screenshot, opens anew in each scheme. */
  openInEachScheme?: true;
};

export type OpenSet = AcceptanceSet<SetCapture>;

/** The directory of the set files, which selection reads as inputs of every group that reaches this module. */
const ACCEPTANCE_SET_DIRECTORY = join(__dirname, 'acceptance-sets');

/** The set files in file-name order. Git keeps no empty directory, so without an open set it is absent. */
export function acceptanceSetFiles(directory = ACCEPTANCE_SET_DIRECTORY): string[] {
  return existsSync(directory) ? readdirSync(directory).toSorted() : [];
}

const registered: OpenSet[] = [];

/** Registers the set of the file that calls it; each file under acceptance-sets/ calls it once. */
export function acceptanceSet(set: OpenSet): void {
  registered.push(set);
}

let loaded: readonly OpenSet[] | undefined;

/**
 * Every open set, in the order of its file name. No import names a set file,
 * so a new set adds a file and edits no shared list; group-qualification.ts
 * makes the directory an input of every group that reaches this module.
 */
export function acceptanceSets(): readonly OpenSet[] {
  if (loaded) return loaded;
  const load = createRequire(__filename);
  for (const file of acceptanceSetFiles()) {
    const before = registered.length;
    load(join(ACCEPTANCE_SET_DIRECTORY, file));
    const set = registered.at(-1);
    if (registered.length !== before + 1 || `${set?.id}.ts` !== file)
      throw new Error(
        `acceptance-sets/${file} must call acceptanceSet once, with the set id the file is named after.`,
      );
  }
  loaded = [...registered];
  return loaded;
}
