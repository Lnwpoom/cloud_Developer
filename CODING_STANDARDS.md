# Coding standards

TypeScript on Node.js, run directly without a build step.

## Conventions

- **Strict types.** Keep `strict` on. Type external input (HTTP, env, files, JSON) as `unknown` and narrow it with a runtime validator at the boundary; inside the boundary, types are trusted.
- **ESM only.** Use `import`/`export`, the `node:` prefix for built-ins (`node:fs/promises`), and file extensions in relative imports as the `tsconfig` module setting requires.
- **Async via `async`/`await`.** Run independent work with `Promise.all`; every promise is awaited or deliberately handled.
- **Errors carry context.** Wrap with `{ cause }`, and handle errors at the layer that can act on them.
- **Config parsed once.** Validate the environment at startup and pass the values down.
- **Small deep modules.** A narrow exported interface over an implementation that does real work; export only what callers need.
- **Named exports**, `const` by default, discriminated unions over boolean flags.

## Enforced by lint

- Throw `Error` subclasses (`class FooError extends Error`), never a plain `new Error(...)`.
- `process.env` is read only in `src/config.ts`.

## Tests

Every new behaviour has a test that failed before the change. Thin I/O modules (the HTTP server, file and network loaders) are tested too: against an ephemeral local server on port 0 or temp files, never the external network.

## Where shared code lives

Reuse these before writing a helper or type of your own:

- **Domain types** (monitored prefix, AS path, observation, origin) and `formatAsn`: `src/domain.ts`.
- **Prefix parsing and containment**: `src/prefix.ts`.
- **Parser helpers** (`ParseResult`, `fail`, `isRecord`, `MAX_ASN`): `src/parsers/parse.ts`.
- **Listener sets** behind every `onChange`: `src/listeners.ts`.
