import type { Bump } from "./semver.js";

/** What a finding means for the version number. */
export type Severity = "breaking" | "minor" | "note";

export type RuleId =
  | "entry-removed"
  | "entry-added"
  | "export-removed"
  | "export-added"
  | "export-changed"
  | "type-narrowed"
  | "type-widened"
  | "export-extended"
  | "enum-value-changed"
  | "constant-changed"
  | "bin-removed"
  | "module-type-changed"
  | "engines-raised";

export interface Finding {
  rule: RuleId;
  severity: Severity;
  /** Public entry point key, e.g. "." or "./retry". */
  entry: string;
  /** Dotted export path inside the entry, e.g. "createClient" or "Http.Method". Empty for package-level rules. */
  symbol: string;
  /** One-line human summary. */
  message: string;
  /** The compiler's own explanation, when there is one. */
  detail?: string;
  /** Changed only because a type it refers to changed; reported, but grouped in text output. */
  transitive?: boolean;
}

export interface Report {
  packageName: string;
  baseline: { label: string; version: string | undefined };
  next: { version: string | undefined };
  findings: Finding[];
  /** The smallest bump that honestly describes the changes found. */
  required: Bump;
  /** The bump actually declared between the two versions, if both parse. */
  declared: Bump | undefined;
  /** Whether the declared bump covers the required one. `undefined` when it can't be judged. */
  ok: boolean | undefined;
  warnings: string[];
  /** Number of exported symbols compared. */
  symbolsCompared: number;
}

export interface Config {
  baseline?: string;
  entries?: string[];
  /** Glob patterns (`*` only) matched against dotted export paths. */
  ignore?: string[];
  /** JSDoc tags that mark an export as non-public. */
  ignoreTags?: string[];
  /** Override how a rule counts toward the version bump. */
  rules?: Partial<Record<RuleId, Severity | "off">>;
}

export type FailOn = "insufficient-bump" | "breaking" | "never";
