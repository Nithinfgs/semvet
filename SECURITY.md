# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
<https://github.com/Nithinfgs/semvet/security/advisories/new>

I will acknowledge reports as soon as I can and credit reporters who want credit.

## What semvet does with untrusted input

- It reads `.d.ts` / `.ts` files and `package.json` from the baseline and from your working tree.
- It never executes code from the packages it compares. Baselines from npm are fetched with
  `npm pack --ignore-scripts`; git baselines use `git archive`; both are unpacked with `tar`.
- It has no network access of its own. The only network use is `npm pack` when you ask for an npm baseline,
  which uses your npm configuration.
- Type-checking hostile declaration files can be slow or memory-hungry. The checker therefore runs in worker
  threads with a time and memory limit (`--timeout`, `--memory`).
- It does not collect telemetry.

## Supported versions

Only the latest release receives fixes.
