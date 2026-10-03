// Portable test runner: `node --test <dir>` and globs behave differently across Node versions.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "dist", "test");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".test.js"))
  .map((f) => path.join(dir, f));
const r = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
