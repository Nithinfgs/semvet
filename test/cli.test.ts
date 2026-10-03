import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { formatMarkdown, formatText } from "../src/report.js";
import type { Report } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const cli = path.join(root, "dist/src/cli.js");
const exampleNew = path.join(root, "examples/acme-http/current");
const exampleOld = path.join(root, "examples/acme-http/v1.4.0");

const tmps: string[] = [];
after(() => {
  for (const t of tmps) rmSync(t, { recursive: true, force: true });
});

function semvet(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", cwd: root });
}

describe("cli", () => {
  it("prints help and exits 0", () => {
    const r = semvet("--help");
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage/);
  });

  it("prints its version", () => {
    const r = semvet("--version");
    assert.equal(r.status, 0);
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  it("fails with exit 1 when the declared bump is too small (acme-http example)", () => {
    const r = semvet(exampleNew, "--baseline", `dir:${exampleOld}`, "--no-color");
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /BREAKING \(\d+\)/);
    assert.match(r.stdout, /createClient/);
    assert.match(r.stdout, /need a major/);
  });

  it("exits 0 with --fail-on never", () => {
    const r = semvet(exampleNew, "-b", `dir:${exampleOld}`, "--fail-on", "never");
    assert.equal(r.status, 0);
  });

  it("passes when --next declares a major", () => {
    const r = semvet(exampleNew, "-b", `dir:${exampleOld}`, "--next", "2.0.0", "--no-color");
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /covers these changes/);
  });

  it("emits valid JSON", () => {
    const r = semvet(exampleNew, "-b", `dir:${exampleOld}`, "-f", "json");
    const report = JSON.parse(r.stdout) as Report;
    assert.equal(report.required, "major");
    assert.equal(report.ok, false);
    assert.ok(report.findings.length > 3);
  });

  it("emits GitHub annotations", () => {
    const r = semvet(exampleNew, "-b", `dir:${exampleOld}`, "-f", "github", "--no-color");
    assert.match(r.stdout, /^::error title=semvet: createClient::/m);
  });

  it("writes a markdown file on request", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "semvet-md-"));
    tmps.push(dir);
    const file = path.join(dir, "out.md");
    semvet(exampleNew, "-b", `dir:${exampleOld}`, "--markdown-file", file);
    const r = spawnSync(
      process.execPath,
      ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(file)},'utf8'))`],
      {
        encoding: "utf8",
      },
    );
    assert.match(r.stdout, /### semvet: `acme-http`/);
  });

  it("exits 2 with a helpful message for an unknown baseline", () => {
    const r = semvet(exampleNew, "-b", "bogus:thing");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Don't know how to read baseline/);
  });

  it("exits 2 for an unknown flag", () => {
    const r = semvet("--nope");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /semvet --help/);
  });

  it("exits 2 when there is no package.json", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "semvet-empty-"));
    tmps.push(dir);
    writeFileSync(path.join(dir, "x.txt"), "");
    const r = semvet(dir, "-b", `dir:${exampleOld}`);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /No package.json/);
  });
});

describe("formatters", () => {
  const report: Report = {
    packageName: "demo",
    baseline: { label: "npm:demo@1.0.0", version: "1.0.0" },
    next: { version: "1.1.0" },
    findings: [
      {
        rule: "export-removed",
        severity: "breaking",
        entry: ".",
        symbol: "gone",
        message: "export was removed",
      },
      {
        rule: "export-added",
        severity: "minor",
        entry: "./sub",
        symbol: "fresh",
        message: "new export",
      },
    ],
    required: "major",
    declared: "minor",
    ok: false,
    warnings: ["something odd"],
    symbolsCompared: 7,
    unchecked: 0,
  };

  it("renders text without color codes when asked", () => {
    const text = formatText(report, { color: false, verbose: false });
    assert.equal(text.includes("\u001b["), false);
    assert.match(text, /BREAKING \(1\)/);
    assert.match(text, /\.\/sub › fresh/);
    assert.match(text, /warning: something odd/);
  });

  it("renders markdown with a table", () => {
    const md = formatMarkdown(report);
    assert.match(md, /\| 🔴 \| `gone` \| export was removed \|/);
    assert.match(md, /7 exports compared/);
  });
});
