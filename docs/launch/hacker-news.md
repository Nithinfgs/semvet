# Hacker News

**Title** (80 chars max; no hype words):

> Show HN: Semvet – check if your TypeScript release needs a major bump

**URL:** https://github.com/Nithinfgs/semvet

**First comment** (post immediately after submitting):

> Hi HN. Rust has cargo-semver-checks; in TypeScript most of us pick the version number by feel, and the breaks
> that hurt are the quiet ones: a parameter that became required, an optional option that got dropped, a return
> type that got wrapped, an enum whose numbers shifted.
>
> semvet generates small programs like `const _: Old.createClient = New.createClient` between the old and new
> declaration files and lets the TypeScript checker decide. So variance, optionality, overloads and the rest are
> the compiler's rules, not mine, and the output includes the compiler's own explanation.
>
> A few things I had to learn the hard way while testing on real packages:
>
> - TypeScript infers a generic function's type parameters when comparing signatures, so `<T>() => Promise<T>` is
>   "assignable" to `<T>() => Promise<{data: T}>`. semvet re-checks generics with opaque probe types.
> - Classes with private members are compared nominally, so two copies of the *same* class never match. I blank
>   private members before comparing.
> - Method parameters are bivariant even under `strict`, so narrowing one slips through. I re-check plain methods
>   through a function-type wrapper. Overloaded/generic methods still slip through; that is listed under known limits.
> - Very recursive APIs can blow the type checker's memory. It runs in worker threads in batches and skips only the
>   offending exports with a warning. I tried it on zod 3.22→3.23 and it exceeded my time budget on that one, so
>   that case produces a partial result rather than a verdict.
>
> It is young. I checked it against commander 11→12 and chalk 4→5 and it flags what those releases are known
> for, but I'd like to hear where it is wrong. The most useful reply is an old/new `.d.ts` pair with the verdict you
> expected.
>
> Runs offline except for an optional `npm pack` of the baseline. No telemetry. MIT.
