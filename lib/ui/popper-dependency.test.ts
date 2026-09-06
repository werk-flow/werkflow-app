import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

const POPPER = "@radix-ui/react-popper";
const manifestSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  overrides: z.record(z.string(), z.unknown()).optional(),
});
type PackageManifest = z.infer<typeof manifestSchema>;
type PopperResolution = { consumer: string; path: string; version: string };

function readManifest(path: string): PackageManifest {
  return manifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function resolvePackageManifest(
  from: string,
  name: string,
  read: (path: string) => PackageManifest = readManifest,
): string {
  const entry = createRequire(from).resolve(name);
  let directory = dirname(entry);
  while (true) {
    const candidate = join(directory, "package.json");
    if (existsSync(candidate) && read(candidate).name === name) {
      return realpathSync(candidate);
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Cannot locate the installed manifest for ${name}: ${entry}`);
    }
    directory = parent;
  }
}

function assertRepairedPopperDependencies(root: string): PopperResolution[] {
  // Consumers share physical packages, but may also own private shadow installs.
  // Cache I/O for this inspection only and retain each importer's resolution boundary.
  const manifests = new Map<string, PackageManifest>();
  const resolvedDependencies = new Map<string, Map<string, string>>();
  function cachedManifest(path: string): PackageManifest {
    const cached = manifests.get(path);
    if (cached) return cached;
    const manifest = readManifest(path);
    manifests.set(path, manifest);
    return manifest;
  }
  function cachedResolution(from: string, name: string): string {
    const dependencies = resolvedDependencies.get(from) ?? new Map<string, string>();
    resolvedDependencies.set(from, dependencies);
    const cached = dependencies.get(name);
    if (cached) return cached;
    const path = resolvePackageManifest(from, name, cachedManifest);
    dependencies.set(name, path);
    return path;
  }
  const rootManifestPath = resolve(root, "package.json");
  const rootManifest = cachedManifest(rootManifestPath);
  const override = rootManifest.overrides?.[POPPER];
  const versionParts = typeof override === "string"
    ? /^(\d+)\.(\d+)\.(\d+)$/.exec(override)
    : null;
  if (!versionParts) throw new Error("Popper override must pin an exact stable release.");
  const major = Number(versionParts[1]);
  const minor = Number(versionParts[2]);
  const patch = Number(versionParts[3]);
  if (major < 1 || (major === 1 && (minor < 3 || (minor === 3 && patch < 2)))) {
    throw new Error("Popper override must include the callback and stable-ref repairs (>=1.3.2).");
  }

  const resolutions: PopperResolution[] = [];
  const consumers = Object.keys(rootManifest.dependencies ?? {})
    .filter((name) => name.startsWith("@radix-ui/"));
  for (const consumer of consumers) {
    const visited = new Set<string>();
    function visit(from: string, name: string, chain: string[]): void {
      const path = cachedResolution(from, name);
      if (visited.has(path)) return;
      visited.add(path);
      if (visited.size > 1024 || chain.length > 32) {
        throw new Error("Installed Radix graph exceeded the dependency guard's traversal limit.");
      }
      const manifest = cachedManifest(path);
      const nextChain = [...chain, name];
      if (name === POPPER) {
        const version = manifest.version;
        if (typeof version !== "string" || version !== override) {
          throw new Error(
            `${nextChain.join(" -> ")} resolves Popper ${manifest.version ?? "without a version"}; ` +
            `expected override ${override}. Installed manifest: ${path}`,
          );
        }
        resolutions.push({ consumer, path, version });
      }
      for (const dependency of Object.keys(manifest.dependencies ?? {})) {
        if (dependency.startsWith("@radix-ui/")) visit(path, dependency, nextChain);
      }
    }
    visit(rootManifestPath, consumer, []);
  }
  if (!resolutions.length) throw new Error("No installed Radix consumer resolved Popper.");
  return resolutions;
}

function writePackage(
  directory: string,
  name: string,
  dependencies: Record<string, string> = {},
  version = "1.0.0",
): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({
    name, version, dependencies, main: "index.js",
  }));
  writeFileSync(join(directory, "index.js"), "module.exports = {};\n");
}

function withInstalledFixture(operation: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "werkflow-popper-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "fixture",
      dependencies: { "@radix-ui/react-dropdown-menu": "1.0.0" },
      overrides: { [POPPER]: "1.3.7" },
    }));
    writePackage(join(root, "node_modules/@radix-ui/react-dropdown-menu"),
      "@radix-ui/react-dropdown-menu", { "@radix-ui/react-menu": "1.0.0" });
    writePackage(join(root, "node_modules/@radix-ui/react-menu"),
      "@radix-ui/react-menu", { [POPPER]: "1.3.7" });
    writePackage(join(root, "node_modules", POPPER), POPPER, {}, "1.3.7");
    operation(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("installed Popper dependency resolution", () => {
  test("every direct Radix consumer reaches the repaired installed override", () => {
    expect(assertRepairedPopperDependencies(resolve(import.meta.dir, "../..")).length)
      .toBeGreaterThan(0);
  });

  test("follows the consumer's nested menu and rejects its stale shadow Popper", () => {
    withInstalledFixture((root) => {
      const nestedMenu = join(root,
        "node_modules/@radix-ui/react-dropdown-menu/node_modules/@radix-ui/react-menu");
      writePackage(nestedMenu, "@radix-ui/react-menu", { [POPPER]: "1.3.1" });
      writePackage(join(nestedMenu, "node_modules", POPPER), POPPER, {}, "1.3.1");
      expect(() => assertRepairedPopperDependencies(root))
        .toThrow("@radix-ui/react-dropdown-menu -> @radix-ui/react-menu -> @radix-ui/react-popper resolves Popper 1.3.1");
    });
  });

  test("accepts a repaired transitive dependency resolved from the root installation", () => {
    withInstalledFixture((root) => {
      expect(assertRepairedPopperDependencies(root)).toHaveLength(1);
    });
  });

  test("shared dependencies retain both consumers without masking another consumer's private shadow", () => {
    withInstalledFixture((root) => {
      const manifestPath = join(root, "package.json");
      const manifest = readManifest(manifestPath);
      const consumer = "@radix-ui/react-context-menu";
      const consumerDirectory = join(root, "node_modules", consumer);
      writeFileSync(manifestPath, JSON.stringify({
        ...manifest,
        dependencies: { ...manifest.dependencies, [consumer]: "1.0.0" },
      }));
      writePackage(consumerDirectory, consumer, { "@radix-ui/react-menu": "1.0.0" });
      const shared = assertRepairedPopperDependencies(root);
      expect(shared.map(({ consumer }) => consumer)).toEqual([
        "@radix-ui/react-dropdown-menu", consumer,
      ]);
      expect(new Set(shared.map(({ path }) => path)).size).toBe(1);

      const privateConsumer = "@radix-ui/react-menubar";
      const privateDirectory = join(root, "node_modules", privateConsumer);
      writePackage(privateDirectory, privateConsumer, { "@radix-ui/react-menu": "1.0.0" });
      writeFileSync(manifestPath, JSON.stringify({
        ...manifest,
        dependencies: { ...manifest.dependencies, [consumer]: "1.0.0", [privateConsumer]: "1.0.0" },
      }));
      const nestedMenu = join(privateDirectory, "node_modules/@radix-ui/react-menu");
      writePackage(nestedMenu, "@radix-ui/react-menu", { [POPPER]: "1.3.1" });
      writePackage(join(nestedMenu, "node_modules", POPPER), POPPER, {}, "1.3.1");
      expect(() => assertRepairedPopperDependencies(root)).toThrow(
        "@radix-ui/react-menubar -> @radix-ui/react-menu -> @radix-ui/react-popper resolves Popper 1.3.1",
      );
    });
  });

  test("matching installed and overridden old versions cannot bypass the repair floor", () => {
    withInstalledFixture((root) => {
      const manifest = readManifest(join(root, "package.json"));
      writeFileSync(join(root, "package.json"), JSON.stringify({
        ...manifest, overrides: { [POPPER]: "1.3.1" },
      }));
      writePackage(join(root, "node_modules", POPPER), POPPER, {}, "1.3.1");
      expect(() => assertRepairedPopperDependencies(root)).toThrow(">=1.3.2");
    });
  });
});
