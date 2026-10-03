# Contributing

Thanks for helping. The fastest way to be useful is a **reproduction**: an old and a new `.d.ts` snippet where
semvet's verdict is wrong.

## Setup

```bash
git clone https://github.com/Nithinfgs/semvet
cd semvet
npm ci
npm test          # builds, then runs every suite
npm run lint      # Biome
npm run demo      # runs the bundled example
```

Node 18.18 or newer. Tests use the built-in `node:test` runner; there is no test framework to install.

## How the code is organised

| File | Role |
|------|------|
| `src/entries.ts` | Resolve public entry points from `package.json` |
| `src/baseline.ts` | Get the old package from npm, git, a directory or a tarball |
| `src/api.ts` | Generate witnesses, run the checker, judge results, drill down |
| `src/neutralize.ts` | Hide private/protected members before comparing |
| `src/runner.ts` | Worker threads, chunking, bisection |
| `src/package-rules.ts` | Non-type rules (bin, module type, engines, subpaths) |
| `src/report.ts` | Text, JSON, Markdown, GitHub annotation output |

`docs/how-it-works.md` explains the witness idea and the rules.

## Adding or changing a rule

1. Add a case to `test/api.test.ts` (or `test/package.test.ts`) using the `run({ old, next })` helper. It builds
   two throwaway packages and returns the report. Write the failing test first.
2. Change `judge()` in `src/api.ts` (type-level rules) or `src/package-rules.ts` (package-level rules).
3. If you add a rule id, add it to `RuleId` in `src/types.ts` so it can be configured.
4. `npm test && npm run lint`.

## Good first issues

See the "Known limits" section of the README; each item is a self-contained improvement
(method bivariance, `readonly`, `declare module` augmentation, wildcard `exports`, ...).

## Pull requests

Keep them focused, add tests, and describe the user-visible effect. Commits follow the
`feat: / fix: / docs: / test: / ci: / chore:` style.
