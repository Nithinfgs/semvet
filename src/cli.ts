#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type CheckOptions, check } from "./check.js";
import { SemvetError } from "./errors.js";
import { formatGithub, formatJson, formatMarkdown, formatText } from "./report.js";
import type { FailOn, Report } from "./types.js";

const HELP = `semvet - does this release need a major bump?

Usage
  semvet [package-dir] [options]

Options
  -b, --baseline <spec>   What to compare against. Default: npm:<name>@latest
                            npm:<name>@<version>   a published version
                            git:<ref>              a tag or commit (needs --entry, or committed d.ts files)
                            dir:<path>             a directory with the old package contents
                            <file>.tgz             an \`npm pack\` tarball
  -e, --entry <file>      Compare this file instead of package.json "exports" (repeatable)
  -n, --next <version>    Version you plan to release. Default: package.json "version"
  -f, --format <name>     text (default), json, markdown, github
      --fail-on <mode>    insufficient-bump (default), breaking, never
      --markdown-file <p> Also write the markdown report to this file
  -c, --config <file>     Config file. Default: semvet.config.json or package.json "semvet"
  -v, --verbose           Show full compiler explanations
      --no-color          Disable colors
  -h, --help              Show this help
      --version           Show the semvet version

Exit codes
  0  fine   1  version bump too small (or breaking changes, with --fail-on breaking)   2  error
`;

function readOwnVersion(): string {
  const url = new URL("../../package.json", import.meta.url);
  return (JSON.parse(readFileSync(url, "utf8")) as { version: string }).version;
}

function shouldFail(report: Report, mode: FailOn): boolean {
  if (mode === "never") return false;
  if (mode === "breaking") return report.findings.some((f) => f.severity === "breaking");
  return report.ok === false;
}

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      baseline: { type: "string", short: "b" },
      entry: { type: "string", short: "e", multiple: true },
      next: { type: "string", short: "n" },
      format: { type: "string", short: "f", default: "text" },
      "fail-on": { type: "string", default: "insufficient-bump" },
      "markdown-file": { type: "string" },
      config: { type: "string", short: "c" },
      verbose: { type: "boolean", short: "v", default: false },
      "no-color": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${readOwnVersion()}\n`);
    return 0;
  }
  if (positionals.length > 1) throw new SemvetError("Expected at most one package directory.");

  const format = values.format ?? "text";
  if (!["text", "json", "markdown", "github"].includes(format)) {
    throw new SemvetError(`Unknown --format "${format}".`, "Use text, json, markdown or github.");
  }
  const failOn = (values["fail-on"] ?? "insufficient-bump") as FailOn;
  if (!["insufficient-bump", "breaking", "never"].includes(failOn)) {
    throw new SemvetError(`Unknown --fail-on "${failOn}".`);
  }

  const opts: CheckOptions = {};
  if (positionals[0]) opts.cwd = positionals[0];
  if (values.baseline) opts.baseline = values.baseline;
  if (values.entry && values.entry.length > 0) opts.entries = values.entry;
  if (values.next) opts.next = values.next;
  if (values.config) opts.configPath = values.config;

  const report = check(opts);
  const color = !values["no-color"] && !process.env.NO_COLOR && (process.stdout.isTTY ?? false);
  const text = { color, verbose: values.verbose ?? false };

  const rendered =
    format === "json"
      ? formatJson(report)
      : format === "markdown"
        ? formatMarkdown(report)
        : format === "github"
          ? formatGithub(report, text)
          : formatText(report, text);
  process.stdout.write(`${rendered}\n`);

  if (values["markdown-file"])
    writeFileSync(values["markdown-file"], `${formatMarkdown(report)}\n`);
  return shouldFail(report, failOn) ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  if (err instanceof SemvetError) {
    process.stderr.write(`semvet: ${err.message}\n`);
    if (err.hint) process.stderr.write(`  hint: ${err.hint}\n`);
  } else if (
    err instanceof TypeError &&
    "code" in err &&
    String(err.code).startsWith("ERR_PARSE_ARGS")
  ) {
    process.stderr.write(`semvet: ${err.message}\n  Try: semvet --help\n`);
  } else {
    process.stderr.write(
      `semvet: unexpected error\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
  }
  process.exitCode = 2;
}
