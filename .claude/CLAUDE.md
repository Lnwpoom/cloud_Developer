# CLAUDE.md

TypeScript on Node.js. Scripts, dependencies and tool versions live in `package.json`, `tsconfig.json` and the lockfile; read them rather than trusting this file for specifics.

## Conventions

- **Strict types.** Keep `strict` on. Type external input (HTTP, env, files, JSON) as `unknown` and narrow it with a runtime validator at the boundary; inside the boundary, types are trusted.
- **ESM only.** Use `import`/`export`, the `node:` prefix for built-ins (`node:fs/promises`), and file extensions in relative imports as the `tsconfig` module setting requires.
- **Async via `async`/`await`.** Run independent work with `Promise.all`; every promise is awaited or deliberately handled.
- **Errors carry context.** Throw `Error` subclasses, wrap with `{ cause }`, and handle them at the layer that can act on them.
- **Config from the environment, parsed once.** Read `process.env` in a single config module, validate it at startup, and pass values down.
- **Small deep modules.** A narrow exported interface over an implementation that does real work; export only what callers need.
- **Named exports**, `const` by default, discriminated unions over boolean flags.

## Definition of done

A change is done when typecheck, lint and the test suite all pass (run the matching `package.json` scripts) and every new behaviour has a test that failed before the change.

## Skills

- Building a feature or fixing a bug test-first → `tdd`
- Something throwing, failing or slow → `diagnosing-bugs`
- Shaping a module's interface or seams → `codebase-design`
- Reviewing a branch or PR → `code-review`
- Writing a PR body → `pr`
