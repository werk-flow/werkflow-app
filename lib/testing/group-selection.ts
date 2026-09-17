import { DEPENDENCY_GATE_INPUTS } from './dependency-audit';

export type SelectableGroup = { id: string; kind: string; inputs: readonly string[] };

/** Missing unrelated proof is a release concern. Change verification selects actual affected inputs. */
export function selectRequiredGroups(input: {
  mode: "change" | "release";
  groups: readonly SelectableGroup[];
  changedFiles: readonly string[];
  unresolvedGroupIds: readonly string[];
}): string[] {
  if (input.mode === "release") return input.groups.map((group) => group.id);
  const knownInputs = new Set(input.groups.flatMap((group) => [...group.inputs]));
  const unknownChange = input.changedFiles.some((file) => !knownInputs.has(file));
  const runtimeChange = input.changedFiles.some((file) => /^(app|components|hooks|lib)\//.test(file) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) && !/^lib\/(testing|docs)\//.test(file));
  return input.groups.filter((group) => group.id === 'static:dependencies'
    ? input.unresolvedGroupIds.includes(group.id) || input.changedFiles.some((file) => DEPENDENCY_GATE_INPUTS.some((dependency) => dependency === file))
    :
    group.kind === "static" || input.unresolvedGroupIds.includes(group.id) || unknownChange ||
    (runtimeChange && group.id === "golden:gg-00") || input.changedFiles.some((file) => group.inputs.includes(file))
  ).map((group) => group.id);
}
