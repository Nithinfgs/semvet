import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
