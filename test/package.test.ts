import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { check } from "../src/check.js";
import { find, run } from "./helpers.js";

const d = "export declare function a(): void;";

describe("package-level rules", () => {
  it("flags a removed subpath export", async () => {
    const exportsMap = (extra: Record<string, unknown>) => ({
      exports: { ".": "./index.d.ts", ...extra },
    });
    const r = await run({
      old: {
        files: { "index.d.ts": d, "sub.d.ts": d },
        pkg: exportsMap({ "./sub": "./sub.d.ts" }),
      },
      next: { files: { "index.d.ts": d }, pkg: exportsMap({}) },
    });
    const f = r.findings.find((x) => x.rule === "entry-removed");
    assert.equal(f?.entry, "./sub");
    assert.equal(r.required, "major");
  });

  it("flags a new subpath export as a feature", async () => {
    const exportsMap = (extra: Record<string, unknown>) => ({
      exports: { ".": "./index.d.ts", ...extra },
    });
    const r = await run({
      old: { files: { "index.d.ts": d }, pkg: exportsMap({}) },
      next: {
        files: { "index.d.ts": d, "sub.d.ts": d },
        pkg: exportsMap({ "./sub": "./sub.d.ts" }),
      },
    });
    assert.equal(r.findings.find((x) => x.rule === "entry-added")?.severity, "minor");
  });

  it("uses the `types` condition and compares each subpath separately", async () => {
    const r = await run({
      old: {
        files: { "dist/a.d.ts": d, "dist/b.d.ts": "export declare const b: string;" },
        pkg: {
          types: undefined,
          exports: {
            ".": { types: "./dist/a.d.ts", default: "./dist/a.js" },
            "./b": { types: "./dist/b.d.ts", default: "./dist/b.js" },
          },
        },
      },
      next: {
        files: { "dist/a.d.ts": d, "dist/b.d.ts": "export declare const b: number;" },
        pkg: {
          types: undefined,
          exports: {
            ".": { types: "./dist/a.d.ts", default: "./dist/a.js" },
            "./b": { types: "./dist/b.d.ts", default: "./dist/b.js" },
          },
        },
      },
    });
    const f = r.findings.find((x) => x.symbol === "b");
    assert.equal(f?.entry, "./b");
    assert.equal(f?.severity, "breaking");
  });

  it("flags a removed bin command", async () => {
    const r = await run({
      old: { files: { "index.d.ts": d }, pkg: { bin: { tool: "cli.js", other: "o.js" } } },
      next: { files: { "index.d.ts": d }, pkg: { bin: { tool: "cli.js" } } },
    });
    assert.equal(r.findings.find((x) => x.rule === "bin-removed")?.severity, "breaking");
  });

  it("flags a change of module type", async () => {
    const r = await run({
      old: { files: { "index.d.ts": d }, pkg: { type: "commonjs" } },
      next: { files: { "index.d.ts": d }, pkg: { type: "module" } },
    });
    assert.ok(r.findings.some((x) => x.rule === "module-type-changed"));
  });

  it("flags a raised minimum Node version but not a lowered one", async () => {
    const raised = await run({
      old: { files: { "index.d.ts": d }, pkg: { engines: { node: ">=18" } } },
      next: { files: { "index.d.ts": d }, pkg: { engines: { node: ">=20.1.0" } } },
    });
    assert.ok(raised.findings.some((x) => x.rule === "engines-raised"));
    const lowered = await run({
      old: { files: { "index.d.ts": d }, pkg: { engines: { node: ">=20" } } },
      next: { files: { "index.d.ts": d }, pkg: { engines: { node: ">=18" } } },
    });
    assert.equal(lowered.findings.length, 0);
  });

  it("falls back to src/ when dist/ has not been built", async () => {
    const r = await run({
      old: { files: { "dist/index.d.ts": d }, pkg: { types: "dist/index.d.ts" } },
      next: {
        files: { "src/index.ts": "export function a(): void {}\nexport function b(): void {}" },
        pkg: { types: "dist/index.d.ts" },
      },
    });
    assert.equal(find(r, "b")?.rule, "export-added");
  });
});

describe("verdict", () => {
  it("fails when the declared bump is too small", async () => {
    const r = await run({
      old: { files: { "index.d.ts": d }, version: "1.2.0" },
      next: { files: { "index.d.ts": "" }, version: "1.3.0" },
    });
    assert.equal(r.required, "major");
    assert.equal(r.declared, "minor");
    assert.equal(r.ok, false);
  });

  it("passes when the declared bump is large enough", async () => {
    const r = await run({
      old: { files: { "index.d.ts": d }, version: "1.2.0" },
      next: { files: { "index.d.ts": "export {};" }, version: "2.0.0" },
    });
    assert.equal(r.ok, true);
  });

  it("applies the 0.x convention: a minor bump covers breaking changes", async () => {
    const r = await run({
      old: { files: { "index.d.ts": d }, version: "0.4.2" },
      next: { files: { "index.d.ts": "export {};" }, version: "0.5.0" },
    });
    assert.equal(r.required, "major");
    assert.equal(r.ok, true);
  });

  it("does not judge an unbumped version", async () => {
    const r = await run({
      old: { files: { "index.d.ts": d }, version: "1.2.0" },
      next: { files: { "index.d.ts": "export {};" }, version: "1.2.0" },
    });
    assert.equal(r.ok, undefined);
    assert.equal(r.required, "major");
  });

  it("reports no change for identical APIs", async () => {
    const r = await run({
      old: { files: { "index.d.ts": d }, version: "1.0.0" },
      next: { files: { "index.d.ts": d }, version: "1.0.1" },
    });
    assert.equal(r.required, "none");
    assert.equal(r.ok, true);
    assert.equal(r.symbolsCompared, 1);
  });
});

describe("limits", () => {
  it("turns an exhausted time budget into a readable error", async () => {
    await assert.rejects(
      run({
        old: "export declare function a(): void;",
        next: "export declare function a(): void;",
        limits: { timeoutMs: 1 },
      }),
      (err: Error) => err.name === "SemvetError" && /took (longer|too long)/.test(err.message),
    );
  });
});

describe("git baselines", () => {
  const dirs: string[] = [];
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]): void {
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
      cwd,
      stdio: "ignore",
    });
  }

  function repo(): { root: string; pkg: string } {
    const root = mkdtempSync(path.join(tmpdir(), "semvet-git-"));
    dirs.push(root);
    // The package lives in a subdirectory to exercise the monorepo path handling.
    const pkg = path.join(root, "packages", "lib");
    mkdirSync(path.join(pkg, "src"), { recursive: true });
    writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "lib", version: "1.0.0", type: "module" }),
    );
    writeFileSync(path.join(pkg, "src", "index.ts"), "export function f(a: string): void {}\n");
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "v1");
    git(root, "tag", "v1.0.0");
    return { root, pkg };
  }

  it("compares the working tree with a tag, from source, inside a subdirectory", async () => {
    const { pkg } = repo();
    writeFileSync(
      path.join(pkg, "src", "index.ts"),
      "export function f(a: string, b: number): void {}\n",
    );
    const r = await check({ cwd: pkg, baseline: "git:v1.0.0", entries: ["src/index.ts"] });
    assert.equal(find(r, "f")?.severity, "breaking");
    assert.equal(r.baseline.label, "git:v1.0.0");
  });

  it("explains how to proceed when the tag has no built types", async () => {
    const { pkg } = repo();
    await assert.rejects(check({ cwd: pkg, baseline: "git:v1.0.0" }), (err: Error) =>
      /no TypeScript declarations/.test(err.message),
    );
  });

  it("reports an unknown git ref clearly", async () => {
    const { pkg } = repo();
    await assert.rejects(
      check({ cwd: pkg, baseline: "git:no-such-tag", entries: ["src/index.ts"] }),
      (err: Error) => err.name === "SemvetError",
    );
  });
});

describe("tarball baselines", () => {
  it("accepts an `npm pack` tarball as the baseline", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "semvet-tgz-"));
    try {
      const oldDir = path.join(root, "old");
      const newDir = path.join(root, "new");
      mkdirSync(oldDir, { recursive: true });
      mkdirSync(newDir, { recursive: true });
      const pkg = { name: "tgz-pkg", types: "index.d.ts" };
      writeFileSync(
        path.join(oldDir, "package.json"),
        JSON.stringify({ ...pkg, version: "1.0.0" }),
      );
      writeFileSync(
        path.join(oldDir, "index.d.ts"),
        "export declare function f(): void;\nexport declare function g(): void;",
      );
      writeFileSync(
        path.join(newDir, "package.json"),
        JSON.stringify({ ...pkg, version: "1.1.0" }),
      );
      writeFileSync(path.join(newDir, "index.d.ts"), "export declare function f(): void;");
      const out = execFileSync("npm", ["pack", "--json", "--pack-destination", root], {
        cwd: oldDir,
        encoding: "utf8",
        shell: process.platform === "win32",
      });
      const file = (JSON.parse(out) as Array<{ filename: string }>)[0]?.filename ?? "";
      const r = await check({ cwd: newDir, baseline: path.join(root, file) });
      assert.equal(find(r, "g")?.rule, "export-removed");
      assert.equal(r.ok, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
