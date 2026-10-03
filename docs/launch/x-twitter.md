# X / Twitter

**Short**

> Rust has cargo-semver-checks. TypeScript had vibes.
>
> semvet checks whether your release needs a major bump by asking the TypeScript compiler if the new API still
> fits the old one.
>
> npx github:Nithinfgs/semvet
> https://github.com/Nithinfgs/semvet

**Technical**

> semvet: semver checks for TS packages.
>
> For every export it generates `const _: Old.x = New.x` and reads tsc's diagnostics, so variance, optionality and
> overloads are the compiler's rules. Generics are re-checked with opaque probe types because tsc *infers* generic
> params and hides `Promise<T>` -> `Promise<{data:T}>` breaks.
>
> Offline, one dep, MIT. https://github.com/Nithinfgs/semvet

**Thread**

> 1/ Most TypeScript libraries pick their version number by feel, and the breaks that slip through are one-line
> type edits that are easy to miss in review. I built semvet to check them. 🧵
>
> 2/ Idea: don't diff signatures, ask the compiler. For each export generate
> `const _: Old.createClient = New.createClient`. If tsc is happy, consumers are too. If not, it tells you why:
> "Target signature provides too few arguments".
>
> 3/ Surprises while building it: tsc infers generic params when comparing signatures, so some real breaks pass.
> Fix: instantiate both sides with the same opaque placeholder types.
>
> 4/ Another: two copies of a class with private members never match, so every class looks broken. Fix: blank out
> private members before comparing.
>
> 5/ And: method params are bivariant even in strict mode. Fix: re-check plain methods through a function-type wrapper.
> (Overloaded and generic methods still slip through. It's in the known limits.)
>
> 6/ Output is a PR-friendly report plus an exit code. Compare against npm, a git tag or a directory. Offline, no
> telemetry.
>
> 7/ It's young. If it's wrong on your package, send me the old/new .d.ts pair. https://github.com/Nithinfgs/semvet
