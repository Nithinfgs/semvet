import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { find, run } from "./helpers.js";

describe("functions", () => {
  it("flags a removed export as breaking", async () => {
    const r = await run({
      old: "export declare function a(): void;\nexport declare function b(): void;",
      next: "export declare function a(): void;",
    });
    assert.equal(find(r, "b")?.rule, "export-removed");
    assert.equal(r.required, "major");
  });

  it("flags a new export as a feature", async () => {
    const r = await run({
      old: "export declare function a(): void;",
      next: "export declare function a(): void;\nexport declare function b(): void;",
    });
    assert.equal(find(r, "b")?.severity, "minor");
    assert.equal(r.required, "minor");
  });

  it("flags a new required parameter", async () => {
    const r = await run({
      old: "export declare function f(a: string): void;",
      next: "export declare function f(a: string, b: number): void;",
    });
    const f = find(r, "f");
    assert.equal(f?.severity, "breaking");
    assert.match(f?.message ?? "", /required parameter/);
  });

  it("allows a new optional parameter, as a feature", async () => {
    const r = await run({
      old: "export declare function f(a: string): void;",
      next: "export declare function f(a: string, b?: number): void;",
    });
    assert.equal(find(r, "f")?.severity, "minor");
    assert.equal(r.required, "minor");
  });

  it("allows widening a parameter type", async () => {
    const r = await run({
      old: "export declare function f(a: string): void;",
      next: "export declare function f(a: string | number): void;",
    });
    assert.equal(r.required, "none");
  });

  it("flags narrowing a parameter type", async () => {
    const r = await run({
      old: "export declare function f(a: string | number): void;",
      next: "export declare function f(a: string): void;",
    });
    assert.equal(find(r, "f")?.severity, "breaking");
  });

  it("allows narrowing a return type", async () => {
    const r = await run({
      old: "export declare function f(): string | number;",
      next: "export declare function f(): string;",
    });
    assert.equal(r.required, "none");
  });

  it("flags widening a return type", async () => {
    const r = await run({
      old: "export declare function f(): string;",
      next: "export declare function f(): string | number;",
    });
    assert.equal(find(r, "f")?.severity, "breaking");
  });

  it("sees through generics: wrapping the return type in a new shape is breaking", async () => {
    const r = await run({
      old: "export declare function load<T>(id: string): Promise<{ data: T }>;",
      next: "export declare function load<T>(id: string): Promise<T>;",
    });
    assert.equal(find(r, "load")?.severity, "breaking");
  });

  it("treats a generic function with the same shape as unchanged", async () => {
    const r = await run({
      old: "export declare function id<T>(x: T): T;",
      next: "export declare function id<U>(x: U): U;",
    });
    assert.equal(r.findings.length, 0);
  });

  it("accepts a new overload", async () => {
    const r = await run({
      old: "export declare function f(a: string): string;",
      next: "export declare function f(a: string): string;\nexport declare function f(a: number): number;",
    });
    assert.equal(r.required === "major", false);
  });
});

describe("object types", () => {
  it("flags a removed optional property", async () => {
    const r = await run({
      old: "export interface O { a?: number; b?: number }",
      next: "export interface O { a?: number }",
    });
    const f = find(r, "O");
    assert.equal(f?.severity, "breaking");
    assert.match(f?.message ?? "", /removed member `b`/);
  });

  it("flags a removed required property", async () => {
    const r = await run({
      old: "export interface O { a: number; b: number }",
      next: "export interface O { a: number }",
    });
    assert.equal(find(r, "O")?.severity, "breaking");
  });

  it("treats a new optional property as a feature", async () => {
    const r = await run({
      old: "export interface O { a: number }",
      next: "export interface O { a: number; b?: string }",
    });
    assert.equal(find(r, "O")?.severity, "minor");
    assert.equal(r.required, "minor");
  });

  it("flags a property that becomes required when callers pass the type in", async () => {
    const r = await run({
      old: "export interface Opts { a?: number }\nexport declare function f(o: Opts): void;",
      next: "export interface Opts { a: number }\nexport declare function f(o: Opts): void;",
    });
    assert.equal(r.required, "major");
    assert.equal(find(r, "f")?.severity, "breaking");
  });

  it("flags a property type change", async () => {
    const r = await run({
      old: "export interface O { a: string }",
      next: "export interface O { a: number }",
    });
    assert.equal(find(r, "O")?.severity, "breaking");
  });

  it("flags a new required type parameter", async () => {
    const r = await run({
      old: "export interface Box<T> { v: T }",
      next: "export interface Box<T, U> { v: T; u: U }",
    });
    assert.equal(find(r, "Box")?.severity, "breaking");
  });

  it("allows a new type parameter that has a default", async () => {
    const r = await run({
      old: "export interface Box<T> { v: T }",
      next: "export interface Box<T, U = string> { v: T }",
    });
    assert.equal(r.required, "none");
  });

  it("flags a type that stops being a value", async () => {
    const r = await run({
      old: "export declare class C { x: number }",
      next: "export interface C { x: number }",
    });
    assert.equal(find(r, "C")?.severity, "breaking");
  });
});

describe("unions and enums", () => {
  it("treats a union that gains a member as a feature", async () => {
    const r = await run({
      old: 'export type M = "a" | "b";',
      next: 'export type M = "a" | "b" | "c";',
    });
    assert.equal(find(r, "M")?.rule, "type-widened");
    assert.equal(r.required, "minor");
  });

  it("flags a union that loses a member", async () => {
    const r = await run({
      old: 'export type M = "a" | "b" | "c";',
      next: 'export type M = "a" | "b";',
    });
    assert.equal(find(r, "M")?.rule, "type-narrowed");
    assert.equal(r.required, "major");
  });

  it("flags a removed enum member", async () => {
    const r = await run({
      old: "export declare enum E { A = 0, B = 1 }",
      next: "export declare enum E { A = 0 }",
    });
    assert.equal(find(r, "E")?.severity, "breaking");
  });

  it("flags enum values that shift", async () => {
    const r = await run({
      old: "export declare enum E { A = 0, B = 1 }",
      next: "export declare enum E { Z = 0, A = 1, B = 2 }",
    });
    assert.equal(find(r, "E")?.rule, "enum-value-changed");
  });

  it("allows appending an enum member", async () => {
    const r = await run({
      old: "export declare enum E { A = 0, B = 1 }",
      next: "export declare enum E { A = 0, B = 1, C = 2 }",
    });
    assert.equal(r.required === "major", false);
  });

  it("only notes a changed constant", async () => {
    const r = await run({
      old: "export declare const LIMIT = 10;",
      next: "export declare const LIMIT = 20;",
    });
    assert.equal(find(r, "LIMIT")?.severity, "note");
    assert.equal(r.required, "none");
  });
});

describe("classes", () => {
  it("flags a removed method", async () => {
    const r = await run({
      old: "export declare class C { a(): void; b(): void }",
      next: "export declare class C { a(): void }",
    });
    assert.equal(find(r, "C")?.severity, "breaking");
  });

  it("treats a new method as a feature", async () => {
    const r = await run({
      old: "export declare class C { a(): void }",
      next: "export declare class C { a(): void; b(): void }",
    });
    assert.equal(find(r, "C")?.severity, "minor");
  });

  it("flags a new required constructor parameter", async () => {
    const r = await run({
      old: "export declare class C { constructor(a: string) }",
      next: "export declare class C { constructor(a: string, b: number) }",
    });
    assert.equal(find(r, "C")?.severity, "breaking");
  });

  it("flags a changed generic method result", async () => {
    const r = await run({
      old: "export declare class C { get<T>(k: string): { value: T } }",
      next: "export declare class C { get<T>(k: string): T }",
    });
    assert.equal(find(r, "C")?.severity, "breaking");
  });

  it("ignores private and protected members (they would otherwise make every class incompatible)", async () => {
    const decl = `export declare class C {
      private secret;
      #hidden;
      protected helper(): void;
      constructor(a: string);
      value(): number;
      next(): C;
    }
    export declare const instance: C;`;
    const r = await run({ old: decl, next: decl });
    assert.deepEqual(r.findings, []);
  });

  it("still flags a removed protected member", async () => {
    const r = await run({
      old: "export declare class C { protected helper(): void; value(): number }",
      next: "export declare class C { value(): number }",
    });
    assert.equal(find(r, "C")?.severity, "breaking");
  });

  it("catches a narrowed method parameter that TypeScript's bivariant method check would let through", async () => {
    const r = await run({
      old: "export interface I { m(a: string | number): void }",
      next: "export interface I { m(a: string): void }",
    });
    assert.equal(find(r, "I")?.severity, "breaking");
    assert.match(find(r, "I")?.message ?? "", /method `m`/);
  });

  it("catches a narrowed class method parameter", async () => {
    const r = await run({
      old: "export declare class C { run(mode: 'a' | 'b'): void }",
      next: "export declare class C { run(mode: 'a'): void }",
    });
    assert.equal(find(r, "C")?.severity, "breaking");
  });

  it("does not flag a widened or merely renamed method parameter", async () => {
    const r = await run({
      old: "export interface I { m(a: string): void; n(x: number): void }",
      next: "export interface I { m(a: string | number): void; n(y: number): void }",
    });
    assert.equal(r.required === "major", false);
  });

  it("flags a static method that disappears", async () => {
    const r = await run({
      old: "export declare class C { static make(): C }",
      next: "export declare class C {}",
    });
    assert.equal(find(r, "C")?.severity, "breaking");
  });
});

describe("module shapes", () => {
  it("compares members inside namespaces", async () => {
    const r = await run({
      old: "export declare namespace N { function f(): void; function g(): void }",
      next: "export declare namespace N { function f(): void }",
    });
    assert.equal(find(r, "N.g")?.rule, "export-removed");
  });

  it("follows `export *` re-exports", async () => {
    const r = await run({
      old: {
        files: {
          "index.d.ts": 'export * from "./a";',
          "a.d.ts": "export declare const x: number;\nexport declare const y: number;",
        },
      },
      next: {
        files: {
          "index.d.ts": 'export * from "./a";',
          "a.d.ts": "export declare const x: number;",
        },
      },
    });
    assert.equal(find(r, "y")?.rule, "export-removed");
  });

  it("follows named re-exports and renames", async () => {
    const r = await run({
      old: {
        files: {
          "index.d.ts": 'export { a as renamed } from "./a";',
          "a.d.ts": "export declare function a(x: string): void;",
        },
      },
      next: {
        files: {
          "index.d.ts": 'export { a as renamed } from "./a";',
          "a.d.ts": "export declare function a(x: number): void;",
        },
      },
    });
    assert.equal(find(r, "renamed")?.severity, "breaking");
  });

  it("compares the default export", async () => {
    const r = await run({
      old: "declare function f(a: string): void;\nexport default f;",
      next: "declare function f(a: string, b: string): void;\nexport default f;",
    });
    assert.equal(find(r, "default")?.severity, "breaking");
  });

  it("handles `export =` modules without crashing", async () => {
    const r = await run({
      old: "declare function f(a: string): void;\nexport = f;",
      next: "declare function f(a: string): void;\nexport = f;",
    });
    assert.equal(r.required, "none");
  });
});

describe("ignoring", () => {
  it("skips exports tagged @internal", async () => {
    const r = await run({
      old: "/** @internal */\nexport declare function secret(): void;\nexport declare function a(): void;",
      next: "export declare function a(): void;",
    });
    assert.equal(r.findings.length, 0);
  });

  it("skips exports matching an ignore glob", async () => {
    const r = await run({
      old: "export declare function _private(): void;\nexport declare function a(): void;",
      next: "export declare function a(): void;",
      config: { ignore: ["_*"] },
    });
    assert.equal(r.findings.length, 0);
  });

  it("lets config downgrade a rule", async () => {
    const r = await run({
      old: "export declare function a(): void;\nexport declare function b(): void;",
      next: "export declare function a(): void;",
      config: { rules: { "export-removed": "note" } },
    });
    assert.equal(find(r, "b")?.severity, "note");
    assert.equal(r.required, "none");
  });

  it("lets config switch a rule off", async () => {
    const r = await run({
      old: "export declare function a(): void;\nexport declare function b(): void;",
      next: "export declare function a(): void;",
      config: { rules: { "export-removed": "off" } },
    });
    assert.equal(r.findings.length, 0);
  });
});
