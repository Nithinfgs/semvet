# Candidate ideas and how they were judged

Scale: 1 (poor) to 5 (strong). "Crowding" is how many near-identical young projects I found.

| # | Idea | Real problem | Demo | Works without paid APIs | Maintenance | Crowding | Verdict |
|---|------|--------------|------|-------------------------|-------------|----------|---------|
| 1 | Linter for AGENTS.md / CLAUDE.md | Instruction rot | 4 | 5 | 3 | very high (agnix 456 rules, agents-lint, AgentLint, ...) | Reject |
| 2 | Agent transcript cost/waste profiler | Token spend | 5 | 5 | 3 | high, and **already covered by existing repos on the target account** | Reject |
| 3 | Agent transcript secret scanner | Secrets in `~/.claude` | 4 | 5 | 3 | covered on the account (sessionscope) | Reject |
| 4 | MCP tool-schema token budget | Hidden context cost | 3 | 4 | 3 | medium; account has mcpscope | Reject |
| 5 | Log/PII redactor with reversible placeholders | Pasting logs into LLMs | 5 | 5 | 3 | very high (shush, redactor, 4+ "pastesafe") | Reject |
| 6 | `.env` drift across code, compose, CI | Missing env vars | 4 | 5 | 3 | very high (10+ envdrift clones) | Reject |
| 7 | OCI image semantic diff (packages, setuid, env, users) | "What changed in my image" | 4 | 5 | 3 | medium (container-diff, diffoci) | Backup |
| 8 | Dependency "why is this in my tree" with install-script and size cost | Supply chain | 3 | 5 | 3 | high | Reject |
| 9 | GitHub Actions cache-miss explainer | CI cost | 3 | 3 (needs API) | 3 | low, but adjacent to existing jobpath on the account | Reject |
| 10 | **Semver breaking-change checker for TypeScript packages** (compiler-driven) | "Did my release break users?" | 5 | 5 | 4 | low-medium: a few young repos, none that I could see using the compiler's own assignability as the engine | **Chosen** |

## Why #10

- **Real, recurring pain.** Every library maintainer ships a version number by gut feel. Rust has
  `cargo-semver-checks`; the TypeScript ecosystem has a few young attempts that work from extracted signatures
  (`semver-checks`, `semver-guard`) but, going by their descriptions (I did not read their source), none that ask the compiler "is the new type assignable to the
  old one?".
- **Technically credible.** The engine is a program that generates `const _: Old.fn = New.fn` witnesses and reads
  TypeScript's own diagnostics. That inherits the language's variance rules (parameter contravariance, return
  covariance, optionality, overloads, generics) instead of re-implementing them badly.
- **Demos in one screen.** One command prints which exports broke, why, and whether the declared version bump
  is enough.
- **No paid API, no network required** (baselines can be a git ref, a directory or a tarball), cheap to run in CI.
- **Contribution surface.** Each rule is small and testable; the known gaps (see README) are good first issues.
- **Natural share moment.** A PR comment saying "this needs a major bump because X" gets forwarded.
- **Not overlapping the target account.** None of the existing repos check library APIs.

## Honest risks

- Type-level comparison of very large, recursive APIs is expensive. Mitigated by running in worker threads,
  bisecting on failure and skipping only the offending exports with a warning.
- TypeScript itself has holes (method bivariance), which the README documents.
- Some young competitors exist; differentiation is the engine, the drill-down explanations and the CI output.
