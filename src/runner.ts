import { cpus } from "node:os";
import { Worker } from "node:worker_threads";
import { type CompareOptions, type CompareResult, type EntryPair, sortFindings } from "./api.js";
import { SemvetError } from "./errors.js";
import type { Finding } from "./types.js";

export interface Limits {
  /** Wall-clock budget for the whole type-checking phase, in milliseconds. */
  timeoutMs: number;
  /** V8 old-generation heap cap per worker, in megabytes. */
  memoryMb: number;
}

export const DEFAULT_LIMITS: Limits = { timeoutMs: 240_000, memoryMb: 2048 };

/** Longest a single worker may run before its batch is split up. */
const ATTEMPT_MS = 45_000;
/** Symbols per worker in the first pass. Small enough that caches stay bounded. */
const CHUNK_SIZE = 40;

type Message =
  | { ok: true; result: CompareResult }
  | { ok: false; message: string; hint?: string; unexpected?: boolean };

class ResourceError extends Error {
  constructor(readonly kind: "memory" | "time") {
    super(kind);
  }
}

function runJob(
  pairs: EntryPair[],
  options: CompareOptions,
  memoryMb: number,
  timeoutMs: number,
): Promise<CompareResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      workerData: { pairs, options },
      resourceLimits: { maxOldGenerationSizeMb: memoryMb },
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => {
        void worker.terminate();
        reject(new ResourceError("time"));
      });
    }, timeoutMs);

    worker.on("message", (m: Message) => {
      finish(() => {
        if (m.ok) resolve(m.result);
        else if (m.unexpected) reject(new Error(m.message));
        else reject(new SemvetError(m.message, m.hint));
      });
    });
    worker.on("error", (err: Error & { code?: string }) => {
      finish(() => {
        reject(err.code === "ERR_WORKER_OUT_OF_MEMORY" ? new ResourceError("memory") : err);
      });
    });
    worker.on("exit", (code) => {
      finish(() => reject(new Error(`semvet worker exited unexpectedly (code ${code}).`)));
    });
  });
}

/**
 * Compares the declarations in worker threads. Type-checking a huge or deeply recursive API can
 * take minutes or exhaust memory, and one such symbol must not sink the whole report. So: try
 * everything at once; if a worker blows its budget, split the work in half and retry, until the
 * offending symbols are isolated. Those are skipped with a warning; everything else is judged.
 */
export async function runCompare(
  pairs: EntryPair[],
  options: CompareOptions,
  limits: Limits = DEFAULT_LIMITS,
): Promise<CompareResult> {
  const deadline = Date.now() + limits.timeoutMs;
  const attempt = (opts: CompareOptions) => {
    const left = deadline - Date.now();
    if (left <= 0) {
      throw new SemvetError(
        `Comparing the declarations took longer than ${Math.round(limits.timeoutMs / 1000)}s.`,
        'Narrow the scope with --entry <file> or an "ignore" list in semvet.config.json, or raise --timeout.',
      );
    }
    return runJob(pairs, opts, limits.memoryMb, Math.min(left, ATTEMPT_MS));
  };

  let listing: CompareResult;
  try {
    listing = await attempt({ ...options, mode: "list" });
  } catch (err) {
    if (!(err instanceof ResourceError)) throw err;
    throw new SemvetError(
      err.kind === "memory"
        ? `The type checker ran out of memory (limit ${limits.memoryMb} MB) while reading the declarations.`
        : "Reading the declarations took too long.",
      "Narrow the scope with --entry <file>, or raise --memory / --timeout.",
    );
  }
  const findings: Finding[] = [...listing.findings];
  const warnings: string[] = [...listing.warnings];
  const ids = listing.compared ?? [];
  let judged = 0;
  const skipped: string[] = [];

  const judge = async (subset: string[]): Promise<void> => {
    if (subset.length === 0) return;
    try {
      const r = await attempt({ ...options, mode: "judge", subset });
      findings.push(...r.findings);
      warnings.push(...r.warnings);
      judged += subset.length;
    } catch (err) {
      if (!(err instanceof ResourceError)) throw err;
      if (subset.length === 1) {
        skipped.push(
          `${subset[0]?.replace("\u0000", " › ")} (${err.kind === "memory" ? "out of memory" : "too slow"})`,
        );
        return;
      }
      const mid = Math.ceil(subset.length / 2);
      await judge(subset.slice(0, mid));
      await judge(subset.slice(mid));
    }
  };
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) chunks.push(ids.slice(i, i + CHUNK_SIZE));
  const concurrency = Math.max(1, Math.min(3, cpus().length - 1));
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, chunks.length) }, async () => {
    for (;;) {
      const chunk = chunks[next++];
      if (!chunk) return;
      await judge(chunk);
    }
  });
  await Promise.all(lanes);

  if (skipped.length > 0) {
    const shown = skipped.slice(0, 5).join(", ");
    const more = skipped.length > 5 ? ` and ${skipped.length - 5} more` : "";
    warnings.push(
      `Could not check ${skipped.length} export(s), their types are too large or recursive for the compiler within the limits: ${shown}${more}. The rest were compared normally.`,
    );
  }
  return { findings: sortFindings(findings), symbolsCompared: judged, warnings };
}
