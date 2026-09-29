# Agent Guide

## Project

This is a thin OpenCode V2 adapter for Caveman. It resolves versioned upstream source at startup and assembles the integration without vendoring Caveman payloads or publishing an npm package. OpenCode loads the TypeScript entrypoint directly; no build step is required.

## Repository layout

- `src/` — upstream resolution and cache, payload catalog, OpenCode bridge, managed-agent sync, configuration, paths, and filesystem helpers.
- `tests/` — unit tests for those modules, including the no-vendoring constraint.
- `README.md` — installation, configuration, runtime behavior, and safety details.

## Development

Requires Node.js 22+ and Bun. Install dependencies with `bun install`. Before submitting changes, run:

```sh
bun run typecheck
bun run test
```

## Contributor guidance

- Keep Caveman payloads out of this repository. Resolve upstream releases to immutable commit SHAs and preserve archive, compatibility, and cache validation.
- Preserve user-owned or modified agent files and existing `caveman` MCP configuration; never overwrite user changes.
- Parse `nodeExecutable` into argv and launch it without a shell.
- Update `README.md` when changing installation, configuration, or runtime behavior. Keep this file focused on contributor guidance; avoid duplicating README details.
