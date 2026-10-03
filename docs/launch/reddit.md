# Reddit

Suggested: r/typescript (check the rules about self-promotion first; many subs want a weekly thread or a
discussion framing), r/node, r/javascript. Don't cross-post the same text.

**Title:** I built a semver checker for TypeScript libraries that asks the compiler instead of diffing signatures

**Body:**

> Maintainers of TS libraries pick version numbers by gut feel, and the breaking changes that slip through are
> usually type-level: an optional parameter becomes required, a property is removed from an options object, a
> return type changes shape.
>
> I wanted something like `cargo-semver-checks`, so I wrote **semvet**. It builds a tiny program for each export,
> `const _: Old.fn = New.fn`, and reads TypeScript's own diagnostics. That way parameter contravariance,
> optionality, overloads and unions are handled by the language rather than reimplemented badly.
>
> How I'd use it: run it in CI against the last published version and fail the PR if the version bump in
> `package.json` is smaller than what the changes need.
>
> What it doesn't do: behavioural changes with unchanged types, `readonly`, `declare module` augmentations, wildcard
> `exports`. Very recursive type-heavy libraries can exceed its time budget; it then reports a partial result and
> names the exports it skipped.
>
> **Feedback I'd like:** (1) packages where it gives a wrong verdict, ideally as an old/new `.d.ts` snippet pair,
> (2) whether the output is clear enough to put in a PR check, (3) whether baselines from git tags/npm cover how you
> release.
>
> Repo (MIT, one dependency: `typescript`): https://github.com/Nithinfgs/semvet
