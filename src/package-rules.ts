import type { EntryPoint, PackageJson } from "./entries.js";
import type { Finding } from "./types.js";

function binNames(pkg: PackageJson): string[] {
  if (!pkg.bin) return [];
  if (typeof pkg.bin === "string") return pkg.name ? [pkg.name.replace(/^@[^/]+\//, "")] : [];
  return Object.keys(pkg.bin);
}

function firstVersion(range: string | undefined): [number, number, number] | undefined {
  if (!range) return undefined;
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range);
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

function isHigher(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Package-level changes that are not visible in any .d.ts file. */
export function comparePackages(
  oldPkg: PackageJson,
  newPkg: PackageJson,
  oldEntries: EntryPoint[],
  newEntries: EntryPoint[],
): Finding[] {
  const findings: Finding[] = [];
  const newKeys = new Set(newEntries.map((e) => e.key));
  const oldKeys = new Set(oldEntries.map((e) => e.key));

  for (const e of oldEntries) {
    if (!newKeys.has(e.key)) {
      findings.push({
        rule: "entry-removed",
        severity: "breaking",
        entry: e.key,
        symbol: "",
        message: `subpath export "${e.key}" was removed`,
      });
    }
  }
  for (const e of newEntries) {
    if (!oldKeys.has(e.key)) {
      findings.push({
        rule: "entry-added",
        severity: "minor",
        entry: e.key,
        symbol: "",
        message: `new subpath export "${e.key}"`,
      });
    }
  }

  const newBins = new Set(binNames(newPkg));
  for (const b of binNames(oldPkg)) {
    if (!newBins.has(b)) {
      findings.push({
        rule: "bin-removed",
        severity: "breaking",
        entry: ".",
        symbol: "",
        message: `command \`${b}\` was removed from "bin"`,
      });
    }
  }

  const oldType = oldPkg.type ?? "commonjs";
  const newType = newPkg.type ?? "commonjs";
  if (oldType !== newType) {
    findings.push({
      rule: "module-type-changed",
      severity: "breaking",
      entry: ".",
      symbol: "",
      message: `package "type" changed from "${oldType}" to "${newType}"`,
    });
  }

  const oldNode = firstVersion(oldPkg.engines?.node);
  const newNode = firstVersion(newPkg.engines?.node);
  if (oldNode && newNode && isHigher(newNode, oldNode)) {
    findings.push({
      rule: "engines-raised",
      severity: "breaking",
      entry: ".",
      symbol: "",
      message: `minimum Node.js raised from ${oldPkg.engines?.node} to ${newPkg.engines?.node}`,
    });
  }
  return findings;
}
