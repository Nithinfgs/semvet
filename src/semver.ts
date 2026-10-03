export interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | undefined;
  raw: string;
}

export type Bump = "major" | "minor" | "patch" | "none";

const RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(raw: string | undefined): Version | undefined {
  if (!raw) return undefined;
  const m = RE.exec(raw.trim());
  if (!m) return undefined;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4],
    raw: raw.trim(),
  };
}

const RANK: Record<Bump, number> = { none: 0, patch: 1, minor: 2, major: 3 };

export function maxBump(a: Bump, b: Bump): Bump {
  return RANK[a] >= RANK[b] ? a : b;
}

/** The kind of step it takes to get from `from` to `to`. Downgrades count as "none". */
export function declaredBump(from: Version, to: Version): Bump {
  if (to.major !== from.major) return to.major > from.major ? "major" : "none";
  if (to.minor !== from.minor) return to.minor > from.minor ? "minor" : "none";
  if (to.patch !== from.patch) return to.patch > from.patch ? "patch" : "none";
  return "none";
}

/**
 * Does moving from `from` to `to` honour a change that needs `required`?
 * Below 1.0.0 semver gives no guarantees, so the convention (and npm's `^0.x` range rules)
 * shifts everything down one level: breaking changes need a minor, features need a patch.
 */
export function satisfies(from: Version, to: Version, required: Bump): boolean {
  if (required === "none") return true;
  const got = declaredBump(from, to);
  const need = from.major === 0 ? shiftDown(required) : required;
  return RANK[got] >= RANK[need];
}

function shiftDown(b: Bump): Bump {
  if (b === "major") return "minor";
  if (b === "minor") return "patch";
  return b;
}
