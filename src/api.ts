import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { findNodeModules } from "./baseline.js";
import { SemvetError } from "./errors.js";
import { neutralizeNominal } from "./neutralize.js";
import type { Finding, Severity } from "./types.js";

export interface EntryPair {
  key: string;
  oldFile: string;
  newFile: string;
}

export interface CompareOptions {
  ignore: string[];
  ignoreTags: string[];
  /** Scratch directory for the generated witness file. */
  workDir: string;
  /** Used to find @types for the compiler. */
  projectDir: string;
  /**
   * "list": only enumerate exports (removed/added) and report which ones need a compiler check.
   * "judge": run the compiler check for `subset` only. Omitted: do both.
   */
  mode?: "list" | "judge";
  /** Symbol ids (see `symbolId`) to check in "judge" mode. */
  subset?: string[];
}

export interface CompareResult {
  findings: Finding[];
  symbolsCompared: number;
  warnings: string[];
  /** In "list" mode: ids of the exports that exist on both sides and still need judging. */
  compared?: string[];
}

export function symbolId(key: string, symbolPath: string): string {
  return `${key}\u0000${symbolPath}`;
}

interface ApiSymbol {
  path: string;
  /** Alias-resolved symbol. */
  symbol: ts.Symbol;
}

interface Compared {
  key: string;
  path: string;
  oldSym: ts.Symbol;
  newSym: ts.Symbol;
  /** Index of the entry pair, used to build the `O<i>.` / `N<i>.` prefixes. */
  pair: number;
}

type WitnessKind = "value" | "A" | "B" | "inst";

interface LineMeta {
  compared: Compared;
  kind: WitnessKind;
  /** For "inst" witnesses: the method being compared, or "" for the export itself. */
  member?: string;
}

interface Verdict {
  value?: string;
  A?: string;
  B?: string;
  inst?: Array<{ member: string; text: string }>;
}

/** A generic callable we can compare after replacing its type parameters with opaque probes. */
interface GenericCallable {
  /** Property name on the export, or "" when the export itself is the function. */
  member: string;
  arities: number[];
}

/** Findings whose cause can be narrowed down to individual members in a second pass. */
const drillable = new WeakSet<Finding>();

const MAX_NAMESPACE_DEPTH = 4;
/** Opaque stand-ins for type parameters: no real type is assignable to or from them. */
const PROBES = ["__P1", "__P2", "__P3"];
const IDENT = /^[A-Za-z_$][\w$]*$/;

function compilerOptions(projectDir: string): ts.CompilerOptions {
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
    jsx: ts.JsxEmit.Preserve,
    types: [],
  };
  const nm = findNodeModules(projectDir);
  if (nm) {
    const typesDir = path.join(nm, "@types");
    if (existsSync(typesDir)) {
      options.typeRoots = [typesDir];
      if (existsSync(path.join(typesDir, "node"))) options.types = ["node"];
    }
  }
  return options;
}

/** A compiler host that hides private members and serves the generated witness file. */
function createHost(
  copts: ts.CompilerOptions,
  virtual?: { path: string; text: string },
): ts.CompilerHost {
  const host = ts.createCompilerHost(copts, true);
  const origRead = host.readFile.bind(host);
  const origExists = host.fileExists.bind(host);
  const origGet = host.getSourceFile.bind(host);
  host.readFile = (file) => {
    if (virtual && file === virtual.path) return virtual.text;
    const text = origRead(file);
    if (text !== undefined && /\.[cm]?tsx?$/.test(file) && !file.includes("/node_modules/")) {
      return neutralizeNominal(file, text);
    }
    return text;
  };
  host.fileExists = (file) => (virtual !== undefined && file === virtual.path) || origExists(file);
  host.getSourceFile = (file, lang, ...rest) =>
    virtual && file === virtual.path
      ? ts.createSourceFile(file, virtual.text, lang, true)
      : origGet(file, lang, ...rest);
  return host;
}

function toSpecifier(file: string): string {
  const f = file.split(path.sep).join("/");
  return f
    .replace(/\.d\.mts$/, ".mjs")
    .replace(/\.d\.cts$/, ".cjs")
    .replace(/\.d\.ts$/, ".js")
    .replace(/\.mts$/, ".mjs")
    .replace(/\.cts$/, ".cjs")
    .replace(/\.tsx?$/, ".js");
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** The module symbol of an entry file, or undefined when the file exists but exports nothing. */
function moduleSymbol(
  checker: ts.TypeChecker,
  program: ts.Program,
  file: string,
): ts.Symbol | undefined {
  const sf = program.getSourceFile(file.split(path.sep).join("/"));
  if (!sf) throw new SemvetError(`TypeScript could not read ${file}.`);
  return checker.getSymbolAtLocation(sf);
}

function hasIgnoredTag(checker: ts.TypeChecker, syms: ts.Symbol[], tags: Set<string>): boolean {
  if (tags.size === 0) return false;
  for (const s of syms) {
    for (const t of s.getJsDocTags(checker)) if (tags.has(t.name.toLowerCase())) return true;
  }
  return false;
}

function collectApi(
  checker: ts.TypeChecker,
  mod: ts.Symbol,
  opts: { ignore: RegExp[]; tags: Set<string> },
  out: Map<string, ApiSymbol>,
  prefix = "",
  depth = 0,
): void {
  for (const exp of checker.getExportsOfModule(mod)) {
    const name = exp.getName();
    const pathName = prefix ? `${prefix}.${name}` : name;
    if (opts.ignore.some((re) => re.test(pathName))) continue;
    let target = exp;
    if (exp.flags & ts.SymbolFlags.Alias) {
      try {
        target = checker.getAliasedSymbol(exp);
      } catch {
        continue;
      }
    }
    if (!target.declarations || target.declarations.length === 0) continue;
    if (hasIgnoredTag(checker, [exp, target], opts.tags)) continue;
    out.set(pathName, { path: pathName, symbol: target });
    const isNamespace =
      target.flags & (ts.SymbolFlags.ValueModule | ts.SymbolFlags.NamespaceModule);
    if (isNamespace && depth < MAX_NAMESPACE_DEPTH && target.exports && target.exports.size > 0) {
      collectApi(checker, target, opts, out, pathName, depth + 1);
    }
  }
}

function genericArities(t: ts.Type): number[] {
  const set = new Set<number>();
  for (const sig of t.getCallSignatures()) {
    const n = sig.typeParameters?.length ?? 0;
    if (n > 0 && n <= 3) set.add(n);
  }
  return [...set];
}

function genericCallables(checker: ts.TypeChecker, sym: ts.Symbol): GenericCallable[] {
  const found: GenericCallable[] = [];
  try {
    if (
      sym.flags & ts.SymbolFlags.Value &&
      sym.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Variable)
    ) {
      const arities = genericArities(checker.getTypeOfSymbol(sym));
      if (arities.length > 0) found.push({ member: "", arities });
    }
    if (sym.flags & ts.SymbolFlags.Type && !(sym.flags & ts.SymbolFlags.TypeParameter)) {
      const declared = checker.getDeclaredTypeOfSymbol(sym);
      for (const p of checker.getPropertiesOfType(declared)) {
        const decl = p.valueDeclaration ?? p.declarations?.[0];
        if (!decl || !IDENT.test(p.getName())) continue;
        const arities = genericArities(checker.getTypeOfSymbolAtLocation(p, decl));
        if (arities.length > 0) found.push({ member: p.getName(), arities });
      }
    }
  } catch {
    // Exotic symbols are simply not probed.
  }
  return found;
}

function typeParamCount(sym: ts.Symbol): number {
  for (const d of sym.declarations ?? []) {
    if (
      ts.isInterfaceDeclaration(d) ||
      ts.isClassDeclaration(d) ||
      ts.isTypeAliasDeclaration(d) ||
      ts.isClassExpression(d)
    ) {
      if (d.typeParameters) return d.typeParameters.length;
    }
  }
  return 0;
}

function isUnionLike(checker: ts.TypeChecker, sym: ts.Symbol): boolean {
  try {
    return checker.getDeclaredTypeOfSymbol(sym).isUnion();
  } catch {
    return false;
  }
}

interface Shape {
  props: Set<string>;
  maxParams: number;
}

function shapeOf(checker: ts.TypeChecker, sym: ts.Symbol): Shape {
  const props = new Set<string>();
  let maxParams = 0;
  try {
    if (sym.flags & ts.SymbolFlags.Value) {
      const t = checker.getTypeOfSymbol(sym);
      for (const p of checker.getPropertiesOfType(t)) props.add(`v:${p.getName()}`);
      for (const s of [...t.getCallSignatures(), ...t.getConstructSignatures()]) {
        maxParams = Math.max(maxParams, s.parameters.length);
      }
    }
    if (sym.flags & ts.SymbolFlags.Type && !(sym.flags & ts.SymbolFlags.TypeParameter)) {
      const t = checker.getDeclaredTypeOfSymbol(sym);
      for (const p of checker.getPropertiesOfType(t)) props.add(`t:${p.getName()}`);
    }
  } catch {
    // Exotic symbols: fall back to "no extra shape information".
  }
  return { props, maxParams };
}

function removedMembers(a: Shape, b: Shape): string[] {
  const removed: string[] = [];
  for (const p of a.props) if (!b.props.has(p)) removed.push(p.slice(2));
  return [...new Set(removed)];
}

/** Members whose numeric/string value differs between two enums, as "Name 0→1". */
function enumValueChanges(checker: ts.TypeChecker, a: ts.Symbol, b: ts.Symbol): string[] {
  if (!(a.flags & ts.SymbolFlags.Enum) || !(b.flags & ts.SymbolFlags.Enum)) return [];
  const changes: string[] = [];
  a.exports?.forEach((member, name) => {
    const other = b.exports?.get(name);
    const da = member.valueDeclaration;
    const db = other?.valueDeclaration;
    if (!da || !db || !ts.isEnumMember(da) || !ts.isEnumMember(db)) return;
    const va = checker.getConstantValue(da);
    const vb = checker.getConstantValue(db);
    if (va !== undefined && vb !== undefined && va !== vb) {
      changes.push(`${String(name)} ${JSON.stringify(va)}→${JSON.stringify(vb)}`);
    }
  });
  return changes;
}

function isConstantChange(checker: ts.TypeChecker, a: ts.Symbol, b: ts.Symbol): boolean {
  try {
    const ta = checker.getTypeOfSymbol(a);
    const tb = checker.getTypeOfSymbol(b);
    if (!ta.isLiteral() || !tb.isLiteral()) return false;
    return typeof ta.value === typeof tb.value;
  } catch {
    return false;
  }
}

function addedMembers(a: Shape, b: Shape): string[] {
  const added: string[] = [];
  for (const p of b.props) if (!a.props.has(p)) added.push(p.slice(2));
  return [...new Set(added)];
}

/** Strip temp paths and `import("...")` noise from compiler messages. */
function cleanMessage(text: string, roots: string[]): string {
  let out = text.replace(/import\("[^"]*"\)\./g, "");
  out = out.replace(/__P1/g, "T").replace(/__P2/g, "U").replace(/__P3/g, "V");
  for (const r of roots) {
    out = out.split(r.split(path.sep).join("/")).join("<pkg>");
    out = out.split(r).join("<pkg>");
  }
  const lines = out.split("\n").filter((l) => l.trim().length > 0);
  const kept = lines.slice(0, 4).map((l) => (l.length > 220 ? `${l.slice(0, 217)}...` : l));
  if (lines.length > 4) kept.push("...");
  return kept.join("\n");
}

function explain(text: string): string {
  if (/Target signature provides too few arguments/.test(text)) {
    return "a required parameter was added";
  }
  if (/is missing in type/.test(text)) return "a member was removed or became required";
  if (
    /only refers to a type, but is being used as a value|refers to a value, but is being used as a type/.test(
      text,
    )
  ) {
    return "changed between a type and a value";
  }
  if (/is not generic|requires (between )?\d+/.test(text)) return "type parameters changed";
  if (/Cannot find name|has no exported member|has no property/.test(text))
    return "no longer exported";
  return "no longer compatible with the previous declaration";
}

export function compareApis(pairs: EntryPair[], options: CompareOptions): CompareResult {
  const warnings: string[] = [];
  const findings: Finding[] = [];
  const copts = compilerOptions(options.projectDir);

  // Phase 1: read both export lists from one program so names line up.
  const roots = pairs
    .flatMap((p) => [p.oldFile, p.newFile])
    .map((f) => f.split(path.sep).join("/"));
  const program1 = ts.createProgram(roots, copts, createHost(copts));
  const checker1 = program1.getTypeChecker();
  const collectOpts = {
    ignore: options.ignore.map(globToRegExp),
    tags: new Set(options.ignoreTags.map((t) => t.toLowerCase())),
  };

  const compared: Compared[] = [];
  pairs.forEach((pair, i) => {
    const oldApi = new Map<string, ApiSymbol>();
    const newApi = new Map<string, ApiSymbol>();
    const oldMod = moduleSymbol(checker1, program1, pair.oldFile);
    const newMod = moduleSymbol(checker1, program1, pair.newFile);
    if (oldMod) collectApi(checker1, oldMod, collectOpts, oldApi);
    if (newMod) collectApi(checker1, newMod, collectOpts, newApi);

    const removed: string[] = [];
    for (const [p, o] of oldApi) {
      if (removed.some((r) => p.startsWith(`${r}.`))) continue;
      const n = newApi.get(p);
      if (!n) {
        removed.push(p);
        findings.push({
          rule: "export-removed",
          severity: "breaking",
          entry: pair.key,
          symbol: p,
          message: "export was removed",
        });
        continue;
      }
      if (!IDENT.test(p.split(".").pop() ?? "")) {
        warnings.push(`Skipped "${p}": not a valid identifier, can't be referenced in a witness.`);
        continue;
      }
      compared.push({ key: pair.key, path: p, oldSym: o.symbol, newSym: n.symbol, pair: i });
    }
    const added: string[] = [];
    for (const p of newApi.keys()) {
      if (oldApi.has(p) || added.some((a) => p.startsWith(`${a}.`))) continue;
      added.push(p);
      findings.push({
        rule: "export-added",
        severity: "minor",
        entry: pair.key,
        symbol: p,
        message: "new export",
      });
    }
  });

  if (options.mode === "list") {
    return {
      findings: sortFindings(findings),
      symbolsCompared: compared.length,
      warnings,
      compared: compared.map((c) => symbolId(c.key, c.path)),
    };
  }
  if (options.mode === "judge") {
    findings.length = 0;
    warnings.length = 0;
    const wanted = new Set(options.subset ?? []);
    for (let i = compared.length - 1; i >= 0; i--) {
      const c = compared[i];
      if (c && !wanted.has(symbolId(c.key, c.path))) compared.splice(i, 1);
    }
  }

  // Phase 2: write the witness file and let the compiler judge every shared export.
  const lines: string[] = [];
  const meta = new Map<number, LineMeta>();
  pairs.forEach((p, i) => {
    lines.push(`import * as O${i} from ${JSON.stringify(toSpecifier(p.oldFile))};`);
    lines.push(`import * as N${i} from ${JSON.stringify(toSpecifier(p.newFile))};`);
  });
  PROBES.forEach((name, i) => {
    lines.push(`interface ${name} { readonly __probe${i + 1}: never }`);
  });
  const importLineCount = lines.length;
  let probeId = 0;
  for (const c of compared) {
    const o = `O${c.pair}.${c.path}`;
    const n = `N${c.pair}.${c.path}`;
    // Enums are skipped here: TypeScript's enum compatibility rule runs the "wrong" way for this
    // purpose (a new member makes `typeof E` incompatible). They get member-level checks instead.
    if (c.oldSym.flags & ts.SymbolFlags.Value && !(c.oldSym.flags & ts.SymbolFlags.Enum)) {
      meta.set(lines.length, { compared: c, kind: "value" });
      lines.push(`{ const _: typeof ${o} = null as unknown as typeof ${n}; }`);
    }
    if (c.oldSym.flags & ts.SymbolFlags.Type && !(c.oldSym.flags & ts.SymbolFlags.TypeParameter)) {
      const count = typeParamCount(c.oldSym);
      const args = count > 0 ? `<${Array.from({ length: count }, () => "any").join(", ")}>` : "";
      meta.set(lines.length, { compared: c, kind: "A" });
      lines.push(`{ const _: ${o}${args} = null as unknown as ${n}${args}; }`);
      meta.set(lines.length, { compared: c, kind: "B" });
      lines.push(`{ const _: ${n}${args} = null as unknown as ${o}${args}; }`);
    }
    for (const g of genericCallables(checker1, c.oldSym)) {
      for (const arity of g.arities) {
        const probes = PROBES.slice(0, arity).join(", ");
        const tArgs =
          typeParamCount(c.oldSym) > 0
            ? `<${Array.from({ length: typeParamCount(c.oldSym) }, () => "any").join(", ")}>`
            : "";
        const [oe, ne] =
          g.member === ""
            ? [`${o}<${probes}>`, `${n}<${probes}>`]
            : [
                `(null as unknown as ${o}${tArgs}).${g.member}<${probes}>`,
                `(null as unknown as ${n}${tArgs}).${g.member}<${probes}>`,
              ];
        const id = probeId++;
        lines.push(`const _o${id} = ${oe};`);
        lines.push(`const _n${id} = ${ne};`);
        meta.set(lines.length, { compared: c, kind: "inst", member: g.member });
        lines.push(`const _w${id}: typeof _o${id} = _n${id};`);
      }
    }
  }

  mkdirSync(options.workDir, { recursive: true });
  const witnessPath = path.join(options.workDir, "__semvet_witness__.ts").split(path.sep).join("/");
  const text = lines.join("\n");
  const host = createHost(copts, { path: witnessPath, text });

  const program2 = ts.createProgram([witnessPath], copts, host);
  const witness = program2.getSourceFile(witnessPath);
  if (!witness) throw new SemvetError("Internal error: witness file was not created.");
  const diagnostics = program2.getSemanticDiagnostics(witness);

  const byPath = new Map<Compared, Verdict>();
  const cleanRoots = [
    ...pairs.flatMap((p) => [path.dirname(p.oldFile), path.dirname(p.newFile)]),
    options.workDir,
  ];
  for (const d of diagnostics) {
    if (d.start === undefined) continue;
    const line = witness.getLineAndCharacterOfPosition(d.start).line;
    if (line < importLineCount) {
      if (d.code === 2307) {
        throw new SemvetError(
          `Could not load an entry point: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`,
        );
      }
      continue;
    }
    const m = meta.get(line);
    if (!m) continue;
    const slot: Verdict = byPath.get(m.compared) ?? {};
    const msg = cleanMessage(ts.flattenDiagnosticMessageText(d.messageText, "\n"), cleanRoots);
    if (m.kind === "inst") {
      slot.inst ??= [];
      if (!slot.inst.some((x) => x.member === (m.member ?? ""))) {
        slot.inst.push({ member: m.member ?? "", text: msg });
      }
    } else if (slot[m.kind] === undefined) {
      slot[m.kind] = msg;
    }
    byPath.set(m.compared, slot);
  }

  const judged: Array<{ c: Compared; f: Finding }> = [];
  for (const c of compared) {
    const verdict = byPath.get(c) ?? {};
    const f = judge(checker1, c, verdict);
    if (f) {
      findings.push(f);
      judged.push({ c, f });
    }
  }

  drillDown(judged, checker1, program2, copts, createHost, cleanRoots, options.workDir);

  return { findings: sortFindings(findings), symbolsCompared: compared.length, warnings };
}

interface MemberRef {
  name: string;
  /** "t": member of the declared (instance) type. "v": member of `typeof export`. */
  side: "t" | "v";
}

function printed(checker: ts.TypeChecker, p: ts.Symbol): string | undefined {
  const decl = p.valueDeclaration ?? p.declarations?.[0];
  if (!decl) return undefined;
  try {
    return checker.typeToString(
      checker.getTypeOfSymbolAtLocation(p, decl),
      undefined,
      ts.TypeFormatFlags.NoTruncation,
    );
  } catch {
    return undefined;
  }
}

/**
 * Members whose printed type differs between old and new (or that vanished). Comparing printed
 * types first keeps self-referential types from making every member look changed just because
 * the type they point at changed.
 */
function memberRefs(checker: ts.TypeChecker, c: Compared): MemberRef[] {
  const out: MemberRef[] = [];
  const consider = (oldProps: ts.Symbol[], newProps: ts.Symbol[], side: "t" | "v") => {
    const byName = new Map(newProps.map((p) => [p.getName(), p]));
    for (const p of oldProps) {
      const name = p.getName();
      if (!IDENT.test(name) || (side === "v" && name === "prototype")) continue;
      const other = byName.get(name);
      if (!other || printed(checker, p) !== printed(checker, other)) out.push({ name, side });
    }
  };
  try {
    const { oldSym, newSym } = c;
    if (oldSym.flags & ts.SymbolFlags.Type && !(oldSym.flags & ts.SymbolFlags.TypeParameter)) {
      consider(
        checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(oldSym)),
        newSym.flags & ts.SymbolFlags.Type
          ? checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(newSym))
          : [],
        "t",
      );
    }
    if (oldSym.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Variable)) {
      consider(
        checker.getPropertiesOfType(checker.getTypeOfSymbol(oldSym)),
        newSym.flags & ts.SymbolFlags.Value
          ? checker.getPropertiesOfType(checker.getTypeOfSymbol(newSym))
          : [],
        "v",
      );
    }
  } catch {
    // no member information for exotic symbols
  }
  return out;
}

/**
 * A failed whole-type comparison ends in "'Foo' and 'Foo' are incompatible", which says nothing
 * about the cause. Re-check member by member and name the ones that actually changed.
 */
function drillDown(
  judged: Array<{ c: Compared; f: Finding }>,
  checker: ts.TypeChecker,
  previous: ts.Program,
  copts: ts.CompilerOptions,
  makeHost: (o: ts.CompilerOptions, v: { path: string; text: string }) => ts.CompilerHost,
  cleanRoots: string[],
  workDir: string,
): void {
  const lines: string[] = [];
  const meta = new Map<number, { f: Finding; member: string }>();
  const header: string[] = [];
  const pairIdx = new Set<number>();
  for (const { c, f } of judged) {
    if (!drillable.has(f)) continue;
    const refs = memberRefs(checker, c);
    if (refs.length === 0) {
      if (
        c.oldSym.flags &
        (ts.SymbolFlags.Class | ts.SymbolFlags.Interface | ts.SymbolFlags.Variable)
      ) {
        f.transitive = true;
        f.message = "affected by changes in the types it references";
        delete f.detail;
      }
      continue;
    }
    if (refs.length > 400) continue;
    pairIdx.add(c.pair);
    const count = typeParamCount(c.oldSym);
    const args = count > 0 ? `<${Array.from({ length: count }, () => "any").join(", ")}>` : "";
    const o = `O${c.pair}.${c.path}`;
    const n = `N${c.pair}.${c.path}`;
    for (const r of refs) {
      meta.set(lines.length, { f, member: r.name });
      lines.push(
        r.side === "t"
          ? `{ const _: ${o}${args}[${JSON.stringify(r.name)}] = null as unknown as ${n}${args}[${JSON.stringify(r.name)}]; }`
          : `{ const _: (typeof ${o})[${JSON.stringify(r.name)}] = null as unknown as (typeof ${n})[${JSON.stringify(r.name)}]; }`,
      );
    }
  }
  if (lines.length === 0) return;

  // Reuse the import lines of the main witness file.
  const first = previous.getSourceFile(previous.getRootFileNames()[0] ?? "");
  const importLines = (first?.text ?? "")
    .split("\n")
    .filter((l) => /^import \* as [ON]\d+ from /.test(l));
  header.push(...importLines);
  const witnessPath = `${workDir.split(path.sep).join("/")}/__semvet_members__.ts`;
  const text = [...header, ...lines].join("\n");
  const program = ts.createProgram(
    [witnessPath],
    copts,
    makeHost(copts, { path: witnessPath, text }),
    previous,
  );
  const sf = program.getSourceFile(witnessPath);
  if (!sf) return;
  const failing = new Map<Finding, Array<{ member: string; text: string }>>();
  for (const d of program.getSemanticDiagnostics(sf)) {
    if (d.start === undefined) continue;
    const line = sf.getLineAndCharacterOfPosition(d.start).line - header.length;
    const m = meta.get(line);
    if (!m) continue;
    const list = failing.get(m.f) ?? [];
    if (!list.some((x) => x.member === m.member)) {
      list.push({
        member: m.member,
        text: cleanMessage(ts.flattenDiagnosticMessageText(d.messageText, "\n"), cleanRoots),
      });
    }
    failing.set(m.f, list);
  }
  for (const [f, list] of failing) {
    const first = list[0];
    if (!first) continue;
    const shown = list.slice(0, 4).map((x) => `\`${x.member}\``);
    const more = list.length > 4 ? ` and ${list.length - 4} more` : "";
    f.message = `members changed incompatibly: ${shown.join(", ")}${more}`;
    f.detail = `${first.member}: ${first.text}`;
  }
}

function judge(checker: ts.TypeChecker, c: Compared, v: Verdict): Finding | undefined {
  const base = { entry: c.key, symbol: c.path };
  const make = (
    rule: Finding["rule"],
    severity: Severity,
    message: string,
    detail?: string,
  ): Finding =>
    detail === undefined
      ? { rule, severity, message, ...base }
      : { rule, severity, message, detail, ...base };

  const oldShape = shapeOf(checker, c.oldSym);
  const newShape = shapeOf(checker, c.newSym);
  const added = addedMembers(oldShape, newShape);
  const grew = newShape.maxParams > oldShape.maxParams;

  const enumChanges = enumValueChanges(checker, c.oldSym, c.newSym);
  if (enumChanges.length > 0) {
    const shown = enumChanges.slice(0, 3).join(", ");
    const more = enumChanges.length > 3 ? `, +${enumChanges.length - 3} more` : "";
    return make("enum-value-changed", "breaking", `enum member values changed: ${shown}${more}`);
  }

  if (v.value !== undefined) {
    if (isConstantChange(checker, c.oldSym, c.newSym)) {
      return make("constant-changed", "note", "constant has a different literal value", v.value);
    }
    const f = make("export-changed", "breaking", explain(v.value), v.value);
    drillable.add(f);
    return f;
  }

  const union = isUnionLike(checker, c.oldSym) || isUnionLike(checker, c.newSym);
  const removedNow = union ? [] : removedMembers(oldShape, newShape);
  if (removedNow.length > 0) {
    // Assignability can't see these: dropping an optional property still type-checks for
    // non-literal values, but callers that wrote the property now get an error.
    const shown = removedNow.slice(0, 4).map((m) => `\`${m}\``);
    const names =
      removedNow.length > 4
        ? `${shown.join(", ")} and ${removedNow.length - 4} more`
        : shown.join(", ");
    return make("export-changed", "breaking", `removed member ${names}`, v.A);
  }

  if (v.inst && v.inst.length > 0) {
    const first = v.inst[0];
    if (first) {
      const where = first.member === "" ? "" : `\`${first.member}\`: `;
      const why = /too few arguments/.test(first.text)
        ? "a required parameter was added"
        : "parameter or return type changed incompatibly";
      return make("export-changed", "breaking", `${where}${why}`, first.text);
    }
  }
  const aFail = v.A !== undefined;
  const bFail = v.B !== undefined;

  if (union) {
    if (aFail && bFail) return make("export-changed", "breaking", explain(v.A ?? ""), v.A);
    if (bFail) {
      return make(
        "type-narrowed",
        "breaking",
        "union or enum lost members that callers may use",
        v.B,
      );
    }
    if (aFail) {
      return make(
        "type-widened",
        "minor",
        "union or enum gained members (can break exhaustive switches)",
        v.A,
      );
    }
  } else {
    if (aFail) {
      const f = make("type-narrowed", "breaking", explain(v.A ?? ""), v.A);
      drillable.add(f);
      return f;
    }
    if (bFail && added.length === 0) {
      return make(
        "export-extended",
        "minor",
        "type became stricter for code that constructs or implements it",
        v.B,
      );
    }
  }

  if (added.length > 0 || grew) {
    const what =
      added.length > 0
        ? `added ${added.map((a) => `\`${a}\``).join(", ")}`
        : "accepts more parameters";
    return make("export-extended", "minor", what);
  }
  return undefined;
}

const SEV_RANK: Record<Severity, number> = { breaking: 0, minor: 1, note: 2 };

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
      a.entry.localeCompare(b.entry) ||
      a.symbol.localeCompare(b.symbol),
  );
}
