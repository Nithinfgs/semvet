import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { find, run } from "./helpers.js";

describe("functions", () => {
  it("flags a removed export as breaking", () => {
    const r = run({
      old: "export declare function a(): void;\nexport declare function b(): void;",
      next: "export declare function a(): void;",
    });
    assert.equal(find(r, "b")?.rule, "export-removed");
    assert.equal(r.required, "major");
  });

  it("flags a new export as a feature", () => {
    const r = run({
      old: "export declare function a(): void;",
      next: "export declare function a(): void;\nexport declare function b(): void;",
    });
    assert.equal(find(r, "b")?.severity, "minor");
    assert.equal(r.required, "minor");
  });

  it("flags a new required parameter", () => {
    const r = run({
      old: "export declare function f(a: string): void;",
      next: "export declare function f(a: string, b: number): void;",
    });
    const f = find(r, "f");
    assert.equal(f?.severity, "breaking");
    assert.match(f?.message ?? "", /required parameter/);
  });

  it("allows a new optional parameter, as a feature", () => {
    const r = run({
      old: "export declare function f(a: string): void;",
      next: "export declare function f(a: string, b?: number): void;",
    });
    assert.equal(find(r, "f")?.severity, "minor");
    assert.equal(r.required, "minor");
  });

  it("allows widening a parameter type", () => {
    const r = run({
      old: "export declare function f(a: string): void;",
      next: "export declare function f(a: string | number): void;",
    });
    assert.equal(r.required, "none");
  });

  it("flags narrowing a parameter type", () => {
    const r = run({
      old: "export declare function f(a: string | number): void;",
      next: "export declare function f(a: string): void;",
    });
    assert.equal(find(r, "f")?.severity, "breaking");
  });

  it("allows narrowing a return type", () => {
    const r = run({
      old: "export declare function f(): string | number;",
      next: "export declare function f(): string;",
    });
    assert.equal(r.required, "none");
  });

  it("flags widening a return type", () => {
    const r = run({
      old: "export declare function f(): string;",
      next: "export declare function f(): string | number;",
    });
    assert.equal(find(r, "f")?.severity, "breaking");
  });

  it("sees through generics: wrapping the return type in a new shape is breaking", () => {
    const r = run({
      old: "export declare function load<T>(id: string): Promise<{ data: T }>;",
      next: "export declare function load<T>(id: string): Promise<T>;",
    });
    assert.equal(find(r, "load")?.severity, "breaking");
  });

  it("treats a generic function with the same shape as unchanged", () => {
    const r = run({
      old: "export declare function id<T>(x: T): T;",
      next: "export declare function id<U>(x: U): U;",
    });
    assert.equal(r.findings.length, 0);
  });

  it("accepts a new overload", () => {
    const r = run({
      old: "export declare function f(a: string): string;",
      next: "export declare function f(a: string): string;\nexport declare function f(a: number): number;",
    });
    assert.equal(r.required === "major", false);
  });
});

describe("object types", () => {
  it("flags a removed optional property", () => {
    const r = run({
      old: "export interface O { a?: number; b?: number }",
      next: "export interface O { a?: number }",
    });
    const f = find(r, "O");
    assert.equal(f?.severity, "breaking");
    assert.match(f?.message ?? "", /removed member `b`/);
  });

  it("flags a removed required property", () => {
    const r = run({
      old: "export interface O { a: number; b: number }",
      next: "export interface O { a: number }",
    });
    assert.equal(find(r, "O")?.severity, "breaking");
  });

  it("treats a new optional property as a feature", () => {
    const r = run({
      old: "export interface O { a: number }",
      next: "export interface O { a: number; b?: string }",
    });
    assert.equal(find(r, "O")?.severity, "minor");
    assert.equal(r.required, "minor");
  });

  it("flags a property that becomes required when callers pass the type in", () => {
    const r = run({
      old: "export interface Opts { a?: number }\nexport declare function f(o: Opts): void;",
      next: "export interface Opts { a: number }\nexport declare function f(o: Opts): void;",
    });
    assert.equal(r.required, "major");
    assert.equal(find(r, "f")?.severity, "breaking");
  });

  it("flags a property type change", () => {
    const r = run({
      old: "export interface O { a: string }",
      next: "export interface O { a: number }",
    });
    assert.equal(find(r, "O")?.severity, "breaking");
  });

  it("flags a new required type parameter", () => {
    const r = run({
      old: "export interface Box<T> { v: T }",
      next: "export interface Box<T, U> { v: T; u: U }",
    });
    assert.equal(find(r, "Box")?.severity, "breaking");
  });

  it("allows a new type parameter that has a default", () => {
    const r = run({
      old: "export interface Box<T> { v: T }",
      next: "export interface Box<T, U = string> { v: T }",
    });
    assert.equal(r.required, "none");
  });

  it("flags a type that stops being a value", () => {
    const r = run({
      old: "export declare class C { x: number }",
      next: "export interface C { x: number }",
    });
    assert.equal(find(r, "C")?.severity, "breaking");
  });
});

describe("unions and enums", () => {
  it("treats a union that gains a member as a feature", () => {
    const r = run({
      old: 'export type M = "a" | "b";',
      next: 'export type M = "a" | "b" | "c";',
    });
    assert.equal(find(r, "M")?.rule, "type-widened");
    assert.equal(r.required, "minor");
  });

  it("flags a union that loses a member", () => {
    const r = run({
      old: 'export type M = "a" | "b" | "c";',
      next: 'export type M = "a" | "b";',
    });
    assert.equal(find(r, "M")?.rule, "type-narrowed");
    assert.equal(r.required, "major");
  });

  it("flags a removed enum member", () => {
    const r = run({
      old: "export declare enum E { A = 0, B = 1 }",
      next: "export declare enum E { A = 0 }",
    });
    assert.equal(find(r, "E")?.severity, "breaking");
  });

  it("flags enum values that shift", () => {
    const r = run({
      old: "export declare enum E { A = 0, B = 1 }",
      next: "export declare enum E { Z = 0, A = 1, B = 2 }",
    });
    assert.equal(find(r, "E")?.rule, "enum-value-changed");
  });

  it("allows appending an enum member", () => {
    const r = run({
      old: "export declare enum E { A = 0, B = 1 }",
      next: "export declare enum E { A = 0, B = 1, C = 2 }",
    });
    assert.equal(r.required === "major", false);
  });

  it("only notes a changed constant", () => {
    const r = run({
      old: "export declare const LIMIT = 10;",
      next: "export declare const LIMIT = 20;",
    });
    assert.equal(find(r, "LIMIT")?.severity, "note");
    assert.equal(r.required, "none");
  });
});

describe("classes", () => {
  it("flags a removed method", () => {
    const r = run({
      old: "export declare class C { a(): void; b(): void }",
      next: "export declare class C { a(): void }",
    });
    assert.equal(find(r, "C")?.severity, "breaking");
  });

  it("treats a new method as a feature", () => {
    const r = run({
      old: "export declare class C { a(): void }",
      next: "export declare class C { a(): void; b(): void }",
    });
    assert.equal(find(r, "C")?.severity, "minor");
  });

  it("flags a new required constructor parameter", () => {
    const r = run({
      old: "export declare class C { constructor(a: string) }",
      next: "export declare class C { constructor(a: string, b: number) }",
    });
    assert.equal(find(r, "C")?.severity, "breaking");
  });

  it("flags a changed generic method result", () => {
    const r = run({
      old: "export declare class C { get<T>(k: string): { value: T } }",
      next: "export declare class C { get<T>(k: string): T }",
    });
    assert.equal(find(r, "C")?.severity, "breaking");
  });

  it("flags a static method that disappears", () => {
    const r = run({
      old: "export declare class C { static make(): C }",
      next: "export declare class C {}",
    });
    assert.equal(find(r, "C")?.severity, "breaking");
  });
});

describe("module shapes", () => {
  it("compares members inside namespaces", () => {
    const r = run({
      old: "export declare namespace N { function f(): void; function g(): void }",
      next: "export declare namespace N { function f(): void }",
    });
    assert.equal(find(r, "N.g")?.rule, "export-removed");
  });

  it("follows `export *` re-exports", () => {
    const r = run({
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

  it("follows named re-exports and renames", () => {
    const r = run({
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

  it("compares the default export", () => {
    const r = run({
      old: "declare function f(a: string): void;\nexport default f;",
      next: "declare function f(a: string, b: string): void;\nexport default f;",
    });
    assert.equal(find(r, "default")?.severity, "breaking");
  });

  it("handles `export =` modules without crashing", () => {
    const r = run({
      old: "declare function f(a: string): void;\nexport = f;",
      next: "declare function f(a: string): void;\nexport = f;",
    });
    assert.equal(r.required, "none");
  });
});

describe("ignoring", () => {
  it("skips exports tagged @internal", () => {
    const r = run({
      old: "/** @internal */\nexport declare function secret(): void;\nexport declare function a(): void;",
      next: "export declare function a(): void;",
    });
    assert.equal(r.findings.length, 0);
  });

  it("skips exports matching an ignore glob", () => {
    const r = run({
      old: "export declare function _private(): void;\nexport declare function a(): void;",
      next: "export declare function a(): void;",
      config: { ignore: ["_*"] },
    });
    assert.equal(r.findings.length, 0);
  });

  it("lets config downgrade a rule", () => {
    const r = run({
      old: "export declare function a(): void;\nexport declare function b(): void;",
      next: "export declare function a(): void;",
      config: { rules: { "export-removed": "note" } },
    });
    assert.equal(find(r, "b")?.severity, "note");
    assert.equal(r.required, "none");
  });

  it("lets config switch a rule off", () => {
    const r = run({
      old: "export declare function a(): void;\nexport declare function b(): void;",
      next: "export declare function a(): void;",
      config: { rules: { "export-removed": "off" } },
    });
    assert.equal(r.findings.length, 0);
  });
});
