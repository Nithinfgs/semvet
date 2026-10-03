import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PackageJson } from "./entries.js";
import { SemvetError } from "./errors.js";
import type { Config, RuleId, Severity } from "./types.js";

const SEVERITIES = new Set(["breaking", "minor", "note", "off"]);

function strings(v: unknown, field: string): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new SemvetError(`Config field "${field}" must be an array of strings.`);
  }
  return v as string[];
}

function validate(raw: unknown): Config {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SemvetError("semvet config must be a JSON object.");
  }
  const o = raw as Record<string, unknown>;
  const config: Config = {};
  if (o.baseline !== undefined) {
    if (typeof o.baseline !== "string")
      throw new SemvetError('Config "baseline" must be a string.');
    config.baseline = o.baseline;
  }
  const entries = strings(o.entries, "entries");
  if (entries) config.entries = entries;
  const ignore = strings(o.ignore, "ignore");
  if (ignore) config.ignore = ignore;
  const ignoreTags = strings(o.ignoreTags, "ignoreTags");
  if (ignoreTags) config.ignoreTags = ignoreTags;
  if (o.rules !== undefined) {
    if (o.rules === null || typeof o.rules !== "object") {
      throw new SemvetError('Config "rules" must be an object.');
    }
    const rules: Partial<Record<RuleId, Severity | "off">> = {};
    for (const [k, v] of Object.entries(o.rules)) {
      if (typeof v !== "string" || !SEVERITIES.has(v)) {
        throw new SemvetError(`Config rule "${k}" must be one of: breaking, minor, note, off.`);
      }
      rules[k as RuleId] = v as Severity | "off";
    }
    config.rules = rules;
  }
  return config;
}

/** Reads `semvet.config.json`, or the "semvet" key of package.json. Explicit --config wins. */
export function loadConfig(projectDir: string, pkg: PackageJson, explicit?: string): Config {
  if (explicit) {
    const file = path.resolve(explicit);
    if (!existsSync(file)) throw new SemvetError(`Config file not found: ${explicit}`);
    return validate(JSON.parse(readFileSync(file, "utf8")));
  }
  const file = path.join(projectDir, "semvet.config.json");
  if (existsSync(file)) return validate(JSON.parse(readFileSync(file, "utf8")));
  if (pkg.semvet !== undefined) return validate(pkg.semvet);
  return {};
}
