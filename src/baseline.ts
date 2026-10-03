import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync } from "node:fs";
import path from "node:path";
import type { PackageJson } from "./entries.js";
import { SemvetError } from "./errors.js";

export interface Baseline {
  /** Directory holding the old package contents (a private copy; safe to read from). */
  dir: string;
  /** Human label such as "npm:acme@1.4.0" or "git:v1.4.0". */
  label: string;
  pkg: PackageJson;
}

interface Ctx {
  projectDir: string;
  pkg: PackageJson;
  /** Scratch directory owned by the caller; removed after the run. */
  tmp: string;
}

const isWin = process.platform === "win32";

function run(cmd: string, args: string[], cwd?: string): string {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: isWin && cmd === "npm",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message: string };
    const stderr = e.stderr ? String(e.stderr).trim() : e.message;
    throw new SemvetError(`\`${cmd} ${args.join(" ")}\` failed:\n${stderr}`);
  }
}

export function findNodeModules(start: string): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, "node_modules");
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function extract(archive: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  run("tar", ["-xf", archive, "-C", dest]);
}

function copyTree(src: string, dest: string): void {
  cpSync(src, dest, {
    recursive: true,
    filter: (p) => {
      const base = path.basename(p);
      return base !== "node_modules" && base !== ".git";
    },
  });
}

function readPkg(dir: string): PackageJson {
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) {
    throw new SemvetError(`No package.json found in baseline at ${dir}.`);
  }
  return JSON.parse(readFileSync(file, "utf8")) as PackageJson;
}

/**
 * Give the old tree the same `node_modules` as the project, so third-party types resolve to the
 * very same files on both sides and compare as identical.
 */
export function linkNodeModules(dir: string, projectDir: string): void {
  const nm = findNodeModules(projectDir);
  if (!nm) return;
  const link = path.join(dir, "node_modules");
  if (existsSync(link)) return;
  symlinkSync(nm, link, "junction");
}

function fromNpm(spec: string, ctx: Ctx): Baseline {
  const dest = path.join(ctx.tmp, "npm");
  mkdirSync(dest, { recursive: true });
  const out = run("npm", ["pack", spec, "--pack-destination", dest, "--json", "--ignore-scripts"]);
  let filename: string | undefined;
  try {
    filename = (JSON.parse(out) as Array<{ filename?: string }>)[0]?.filename;
  } catch {
    // fall through to the error below
  }
  if (!filename) throw new SemvetError(`Could not read the result of \`npm pack ${spec}\`.`);
  const root = path.join(ctx.tmp, "npm-x");
  extract(path.join(dest, filename), root);
  const dir = path.join(root, "package");
  const pkg = readPkg(dir);
  return { dir, label: `npm:${pkg.name ?? spec}@${pkg.version ?? "?"}`, pkg };
}

function fromTarball(file: string, ctx: Ctx): Baseline {
  const root = path.join(ctx.tmp, "tgz-x");
  extract(path.resolve(file), root);
  const dir = existsSync(path.join(root, "package")) ? path.join(root, "package") : root;
  return { dir, label: `tarball:${path.basename(file)}`, pkg: readPkg(dir) };
}

function fromDir(src: string, ctx: Ctx): Baseline {
  const abs = path.resolve(src);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new SemvetError(`Baseline directory not found: ${src}`);
  }
  const dir = path.join(ctx.tmp, "dir");
  copyTree(abs, dir);
  return { dir, label: `dir:${path.basename(abs)}`, pkg: readPkg(dir) };
}

function fromGit(ref: string, ctx: Ctx): Baseline {
  let top: string;
  try {
    top = run("git", ["rev-parse", "--show-toplevel"], ctx.projectDir).trim();
  } catch {
    throw new SemvetError(`${ctx.projectDir} is not inside a git repository.`);
  }
  const rel = path.relative(top, ctx.projectDir).split(path.sep).join("/");
  const treeish = rel ? `${ref}:${rel}` : ref;
  const tarFile = path.join(ctx.tmp, "git.tar");
  run("git", ["archive", "--format=tar", "-o", tarFile, treeish], top);
  const dir = path.join(ctx.tmp, "git-x");
  extract(tarFile, dir);
  return { dir, label: `git:${ref}`, pkg: readPkg(dir) };
}

export function acquireBaseline(spec: string | undefined, ctx: Ctx): Baseline {
  let b: Baseline;
  if (spec === undefined || spec === "npm") {
    if (!ctx.pkg.name) {
      throw new SemvetError(
        'package.json has no "name", so the latest published version can\'t be looked up.',
        "Pass --baseline git:<tag>, dir:<path> or npm:<name>@<version>.",
      );
    }
    b = fromNpm(`${ctx.pkg.name}@latest`, ctx);
  } else if (spec.startsWith("npm:")) {
    b = fromNpm(spec.slice(4), ctx);
  } else if (spec.startsWith("git:")) {
    b = fromGit(spec.slice(4), ctx);
  } else if (spec.startsWith("dir:")) {
    b = fromDir(spec.slice(4), ctx);
  } else if (/\.(tgz|tar\.gz)$/.test(spec)) {
    b = fromTarball(spec, ctx);
  } else if (existsSync(spec) && statSync(spec).isDirectory()) {
    b = fromDir(spec, ctx);
  } else {
    throw new SemvetError(
      `Don't know how to read baseline "${spec}".`,
      "Use npm:<name>@<version>, git:<ref>, dir:<path>, or a .tgz file.",
    );
  }
  linkNodeModules(b.dir, ctx.projectDir);
  return b;
}
