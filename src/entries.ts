import { existsSync } from "node:fs";
import path from "node:path";

export interface PackageJson {
  name?: string;
  version?: string;
  type?: string;
  main?: string;
  types?: string;
  typings?: string;
  exports?: unknown;
  bin?: string | Record<string, string>;
  engines?: Record<string, string>;
  semvet?: unknown;
}

export interface EntryPoint {
  /** "." or "./subpath", exactly as written in package.json `exports`. */
  key: string;
  /** Absolute path to the file TypeScript should read for this entry. */
  file: string;
}

export interface ResolvedEntries {
  entries: EntryPoint[];
  warnings: string[];
}

const OUT_DIRS = new Set(["dist", "lib", "build", "out", "types", "esm", "cjs"]);

/** Map a runtime file (`dist/a.js`) to the declaration or source file that describes it. */
function typesFor(pkgDir: string, rel: string): string | undefined {
  const abs = path.resolve(pkgDir, rel);
  const candidates: string[] = [];
  if (/\.d\.[cm]?ts$/.test(abs)) candidates.push(abs);
  const swap = (from: RegExp, to: string) => abs.replace(from, to);
  if (/\.js$/.test(abs)) candidates.push(swap(/\.js$/, ".d.ts"));
  if (/\.mjs$/.test(abs)) candidates.push(swap(/\.mjs$/, ".d.mts"));
  if (/\.cjs$/.test(abs)) candidates.push(swap(/\.cjs$/, ".d.cts"));
  if (/\.[cm]?tsx?$/.test(abs) && !/\.d\.[cm]?ts$/.test(abs)) candidates.push(abs);
  for (const c of candidates) if (existsSync(c)) return c;

  // Not built yet? Fall back to the matching file under src/.
  const parts = path.relative(pkgDir, abs).split(path.sep);
  const first = parts[0];
  if (first !== undefined && OUT_DIRS.has(first)) {
    const base = path.join(pkgDir, "src", ...parts.slice(1)).replace(/(\.d)?\.[cm]?[jt]sx?$/, "");
    for (const ext of [".ts", ".tsx", ".mts", ".cts"]) {
      if (existsSync(base + ext)) return base + ext;
    }
  }
  return undefined;
}

function resolveTarget(pkgDir: string, target: unknown, warnings: string[]): string | undefined {
  if (typeof target === "string") {
    if (target.includes("*")) {
      warnings.push(
        `Skipped pattern export target "${target}" (wildcard exports are not expanded).`,
      );
      return undefined;
    }
    return typesFor(pkgDir, target);
  }
  if (Array.isArray(target)) {
    for (const t of target) {
      const r = resolveTarget(pkgDir, t, warnings);
      if (r) return r;
    }
    return undefined;
  }
  if (target && typeof target === "object") {
    const obj = target as Record<string, unknown>;
    // `types` always wins; otherwise take conditions in the author's order.
    const order = ["types", ...Object.keys(obj).filter((k) => k !== "types")];
    for (const cond of order) {
      if (!(cond in obj)) continue;
      const r = resolveTarget(pkgDir, obj[cond], warnings);
      if (r) return r;
    }
  }
  return undefined;
}

function normalizeExports(exp: unknown): Record<string, unknown> | undefined {
  if (exp === undefined || exp === null) return undefined;
  if (typeof exp === "string" || Array.isArray(exp)) return { ".": exp };
  if (typeof exp === "object") {
    const keys = Object.keys(exp as object);
    if (keys.length > 0 && keys.every((k) => k.startsWith(".")))
      return exp as Record<string, unknown>;
    return { ".": exp };
  }
  return undefined;
}

export function resolveEntries(
  pkgDir: string,
  pkg: PackageJson,
  overrides: string[] = [],
): ResolvedEntries {
  const warnings: string[] = [];
  if (overrides.length > 0) {
    const entries: EntryPoint[] = [];
    for (const o of overrides) {
      const file = path.resolve(pkgDir, o);
      if (!existsSync(file)) {
        warnings.push(`Entry "${o}" does not exist in ${pkgDir}.`);
        continue;
      }
      entries.push({ key: o.split(path.sep).join("/"), file });
    }
    return { entries, warnings };
  }

  const entries: EntryPoint[] = [];
  const map = normalizeExports(pkg.exports);
  if (map) {
    for (const [key, target] of Object.entries(map)) {
      if (key === "./package.json") continue;
      if (target === null) continue;
      if (key.includes("*")) {
        warnings.push(`Skipped pattern subpath "${key}" (wildcard exports are not expanded).`);
        continue;
      }
      const file = resolveTarget(pkgDir, target, warnings);
      if (file) entries.push({ key, file });
      else if (key === "." || typeof target === "string" || typeof target === "object") {
        warnings.push(`No TypeScript declarations found for export "${key}".`);
      }
    }
    return { entries, warnings };
  }

  const typesField = pkg.types ?? pkg.typings;
  const file =
    (typesField ? typesFor(pkgDir, typesField) : undefined) ??
    (pkg.main ? typesFor(pkgDir, pkg.main) : undefined) ??
    typesFor(pkgDir, "index.js");
  if (file) entries.push({ key: ".", file });
  return { entries, warnings };
}
