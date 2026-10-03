import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";
import { check } from "../src/check.js";
import type { Config, Finding, Report } from "../src/types.js";

const roots: string[] = [];

after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

export interface PkgSpec {
  /** File name -> contents. `index.d.ts` is the default entry. */
  files: Record<string, string>;
  version?: string;
  /** Extra package.json fields (merged last). */
  pkg?: Record<string, unknown>;
}

export function makePkg(dir: string, spec: PkgSpec): void {
  mkdirSync(dir, { recursive: true });
  const pkg = {
    name: "fixture-pkg",
    version: spec.version ?? "1.0.0",
    types: "index.d.ts",
    ...spec.pkg,
  };
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  for (const [name, text] of Object.entries(spec.files)) {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}

export interface Case {
  old: string | PkgSpec;
  next: string | PkgSpec;
  config?: Config;
  limits?: { timeoutMs?: number; memoryMb?: number };
}

function spec(s: string | PkgSpec): PkgSpec {
  return typeof s === "string" ? { files: { "index.d.ts": s } } : s;
}

/** Build an old and a new package side by side and run semvet between them. */
export async function run(c: Case): Promise<Report> {
  const root = mkdtempSync(path.join(tmpdir(), "semvet-test-"));
  roots.push(root);
  const oldDir = path.join(root, "old");
  const newDir = path.join(root, "new");
  makePkg(oldDir, spec(c.old));
  makePkg(newDir, spec(c.next));
  if (c.config) writeFileSync(path.join(newDir, "semvet.config.json"), JSON.stringify(c.config));
  return await check({
    cwd: newDir,
    baseline: `dir:${oldDir}`,
    ...(c.limits ? { limits: c.limits } : {}),
  });
}

export function find(report: Report, symbol: string): Finding | undefined {
  return report.findings.find((f) => f.symbol === symbol);
}
