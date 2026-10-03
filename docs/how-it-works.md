# How semvet works

## The idea: witnesses

A release is backward compatible when everything that type-checked against the old API still type-checks
against the new one. TypeScript already knows how to answer "does this value fit that type?", including all
the variance rules. So semvet writes small programs whose only job is to ask that question:

```ts
import * as Old from "<old>/index.d.ts";
import * as New from "<new>/index.d.ts";

const _: typeof Old.createClient = null as unknown as typeof New.createClient;
```

If the new `createClient` can stand in wherever the old one was used, this compiles. If it can't, TypeScript
reports exactly why:

```
Type '(baseUrl: string, apiKey: string) => Client' is not assignable to type '(baseUrl: string) => Client'.
  Target signature provides too few arguments. Expected 2 or more, but got 1.
```

semvet reads those diagnostics and turns them into findings. It does not re-implement type compatibility.

## Pipeline

1. **Entry points** come from `package.json` `exports` (honouring the `types` condition and falling back from
   `dist/*.js` to `src/*.ts` when nothing is built), or from `--entry`.
2. **Baseline** is copied into a temp directory and given a symlink to the project's `node_modules` so third-party
   types resolve to the same files on both sides.
3. **Listing:** both export lists are read from one program. Missing exports are *removed*, new ones *added*.
4. **Witnesses** are generated for every export that exists on both sides, and the checker runs in a worker thread.
5. **Judging** maps each failing witness to a finding (below).
6. **Drill-down:** a failing type is re-checked member by member so the report names what changed.
7. **Verdict:** the highest severity decides the required bump, compared with the declared one.

## What gets generated

| Export kind | Witness |
|-------------|---------|
| Function, variable, class (static side) | `typeof Old.x` ← `typeof New.x` |
| Interface, type alias, class (instance side) | `Old.T<any…>` ← `New.T<any…>` (**A**), and the reverse (**B**) |
| Generic function or method | the same, after instantiating type parameters with opaque probe types |
| Namespace | members are compared recursively as `NS.member` |
| Enum | member values are compared directly; the type is judged as a union |

**Why probe types?** For generic signatures TypeScript *infers* the source's type parameters from the target,
so `<T>(id) => Promise<T>` is "assignable" to `<T>(id) => Promise<{data: T}>`. That is true in the type system
and wrong for a consumer who writes `load<User>(...)`. Instantiating both sides with the same unrelated
placeholder types removes the inference and exposes the break.

**Why neutralise private members?** TypeScript treats two declarations of the same class that have private
or protected members as unrelated (the check is nominal), so every such class would look broken. Before
comparing, private members are blanked out and `protected` becomes public. Offsets are preserved.

## Rules

| Rule | Severity | Meaning |
|------|----------|---------|
| `export-removed` | breaking | An export disappeared |
| `export-changed` | breaking | New type is not assignable to the old (or a member was removed, or a generic signature changed) |
| `type-narrowed` | breaking | Object type lost or changed members; union/enum lost members |
| `enum-value-changed` | breaking | An enum member now has a different value |
| `entry-removed` | breaking | A subpath export was removed |
| `bin-removed` | breaking | A `bin` command was removed |
| `module-type-changed` | breaking | `"type"` changed between commonjs and module |
| `engines-raised` | breaking | Minimum Node.js version went up |
| `export-added`, `entry-added` | minor | New export or subpath |
| `export-extended` | minor | New members or optional parameters |
| `type-widened` | minor | Union/enum gained members |
| `constant-changed` | note | A `const` literal has a different value |

Any rule can be re-classified or switched off in `semvet.config.json`:

```json
{
  "ignore": ["internal*", "Http.legacy*"],
  "ignoreTags": ["internal", "alpha"],
  "rules": { "engines-raised": "note", "constant-changed": "off" }
}
```

## Verdict and 0.x versions

The required bump is `major` if anything is breaking, `minor` if anything was added, otherwise `none`.
Below 1.0.0 the convention shifts down one level (breaking changes need a minor, features a patch), matching how
npm treats `^0.x` ranges.

## Known limits

These are real. Each is a reasonable contribution.

- **Method bivariance.** TypeScript checks method parameters bivariantly even under `strict`. semvet re-checks
  plain methods strictly (one signature, not generic) when their printed signature changed. Overloaded and generic
  methods are still compared the way TypeScript compares them, so a narrowed parameter there can slip through.
- **Overloads** are compared as TypeScript compares them; a reordering that changes which overload wins is not detected.
- **`readonly` and `unique symbol`** changes are invisible to assignability.
- **`declare module` augmentations and global declarations** are not part of the compared export surface.
- **Wildcard `exports` patterns** (`"./features/*"`) are skipped with a warning.
- **Behavioural changes** with identical types are out of scope.
- **Very large, deeply recursive APIs** (heavily generic validation or ORM libraries) can exceed the time/memory
  budget. Those exports are skipped with a warning naming them; everything else is still compared.
- **Dependencies are shared.** The old package is type-checked against the *current* `node_modules`. A change that
  only exists because a dependency's types changed is attributed to neither side.
- **Printed types for generic probes** show `T`/`U`/`V` for the placeholders.
