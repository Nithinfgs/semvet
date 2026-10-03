import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareApis, type EntryPair, sortFindings } from "./api.js";
import { acquireBaseline } from "./baseline.js";
import { loadConfig } from "./config.js";
import { type PackageJson, resolveEntries } from "./entries.js";
import { SemvetError } from "./errors.js";
import { comparePackages } from "./package-rules.js";
import { DEFAULT_LIMITS, type Limits, runCompare } from "./runner.js";
import { type Bump, declaredBump, maxBump, parseVersion, satisfies } from "./semver.js";
import type { Finding, Report, Severity } from "./types.js";

export interface CheckOptions {
  /** Package directory to check. Defaults to the current directory. */
  cwd?: string;
  /** npm:<spec>, git:<ref>, dir:<path>, a .tgz, or omitted for the latest published version. */
  baseline?: string;
  /** Entry files relative to the package root, used instead of package.json exports. */
  entries?: string[];
  /** Version you intend to release; defaults to package.json "version". */
  next?: string;
  configPath?: string;
  /** Time and memory budget for the type-checking phase. */
  limits?: Partial<Limits>;
}

function requiredBump(findings: Finding[]): Bump {
  let bump: Bump = "none";
  for (const f of findings) {
    if (f.severity === "breaking") return "major";
    if (f.severity === "minor") bump = maxBump(bump, "minor");
  }
  return bump;
}

export async function check(options: CheckOptions = {}): Promise<Report> {
  const projectDir = path.resolve(options.cwd ?? process.cwd());
  const pkgFile = path.join(projectDir, "package.json");
  if (!existsSync(pkgFile)) throw new SemvetError(`No package.json in ${projectDir}.`);
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as PackageJson;
  const config = loadConfig(projectDir, pkg, options.configPath);
  const overrides = options.entries ?? config.entries ?? [];

  const tmp = mkdtempSync(path.join(tmpdir(), "semvet-"));
  try {
    const baseline = acquireBaseline(options.baseline ?? config.baseline, { projectDir, pkg, tmp });
    const warnings: string[] = [];

    const oldRes = resolveEntries(baseline.dir, baseline.pkg, overrides);
    const newRes = resolveEntries(projectDir, pkg, overrides);
    warnings.push(...oldRes.warnings.map((w) => `baseline: ${w}`), ...newRes.warnings);

    if (oldRes.entries.length === 0) {
      throw new SemvetError(
        `The baseline (${baseline.label}) has no TypeScript declarations to compare against.`,
        "Pick a baseline that ships .d.ts files, or pass --entry <file> (e.g. src/index.ts).",
      );
    }
    if (newRes.entries.length === 0) {
      throw new SemvetError(
        "Could not find the package's TypeScript declarations.",
        'Build first so "types" points at a real file, or pass --entry src/index.ts.',
      );
    }

    const oldByKey = new Map(oldRes.entries.map((e) => [e.key, e.file]));
    const pairs: EntryPair[] = [];
    for (const e of newRes.entries) {
      const oldFile = oldByKey.get(e.key);
      if (oldFile) pairs.push({ key: e.key, oldFile, newFile: e.file });
    }

    const findings: Finding[] = comparePackages(baseline.pkg, pkg, oldRes.entries, newRes.entries);
    let symbolsCompared = 0;
    if (pairs.length > 0) {
      const result = await runCompare(
        pairs,
        {
          ignore: config.ignore ?? [],
          ignoreTags: config.ignoreTags ?? ["internal", "alpha"],
          workDir: path.join(tmp, "witness"),
          projectDir,
        },
        { ...DEFAULT_LIMITS, ...options.limits },
      );
      findings.push(...result.findings);
      warnings.push(...result.warnings);
      symbolsCompared = result.symbolsCompared;
    }

    const adjusted: Finding[] = [];
    for (const f of findings) {
      const override = config.rules?.[f.rule];
      if (override === "off") continue;
      adjusted.push(override ? { ...f, severity: override as Severity } : f);
    }

    const nextRaw = options.next ?? pkg.version;
    const from = parseVersion(baseline.pkg.version);
    const to = parseVersion(nextRaw);
    const required = requiredBump(adjusted);
    const declared = from && to ? declaredBump(from, to) : undefined;
    const ok = from && to && declared !== "none" ? satisfies(from, to, required) : undefined;

    return {
      packageName: pkg.name ?? path.basename(projectDir),
      baseline: { label: baseline.label, version: baseline.pkg.version },
      next: { version: nextRaw },
      findings: sortFindings(adjusted),
      required,
      declared,
      ok,
      warnings,
      symbolsCompared,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
