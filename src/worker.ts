import { parentPort, workerData } from "node:worker_threads";
import { type CompareOptions, compareApis, type EntryPair } from "./api.js";
import { SemvetError } from "./errors.js";

interface Job {
  pairs: EntryPair[];
  options: CompareOptions;
}

try {
  const job = workerData as Job;
  parentPort?.postMessage({ ok: true, result: compareApis(job.pairs, job.options) });
} catch (err) {
  if (err instanceof SemvetError) {
    parentPort?.postMessage({ ok: false, message: err.message, hint: err.hint });
  } else {
    parentPort?.postMessage({
      ok: false,
      message: err instanceof Error ? (err.stack ?? err.message) : String(err),
      unexpected: true,
    });
  }
}
