# LinkedIn

> Version numbers in TypeScript libraries are usually chosen by feel, and the breaking changes that slip through are
> quiet ones: a parameter that became required, an option that was removed, a return type that changed shape.
>
> I built an open-source tool, semvet, that checks this before release. Instead of diffing signatures as text, it asks
> the TypeScript compiler whether the new API is still assignable to the old one, then reports which export broke,
> why, and whether the declared version bump is big enough. It runs offline, has one dependency, and plugs into CI.
>
> The part I found most interesting was how often the compiler's own rules hide real breaks: generic functions get
> their type parameters inferred, classes with private members never match across versions, and method parameters are
> bivariant. Each needed a specific workaround, and each is covered by tests.
>
> It is early, so I'm looking for packages where it gets the verdict wrong.
> https://github.com/Nithinfgs/semvet
