# opencode-caveman

Thin OpenCode V2 adapter for [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman).

Install plugin directly from Git; no npm package publication. Wrapper vendors **zero Caveman source, prompts, skills, agents, commands, rules, hooks, or binaries**.
Every plugin startup discovers upstream Git tags with Git, selects configured Caveman semver range, pins selected tag to immutable commit SHA, and assembles OpenCode integration from that source tree.

## Installation

Add plugin to OpenCode configuration using a pinned Git commit:

```json
{
  "plugins": [
    "opencode-caveman@git+https://github.com/rozsazoltan/opencode-caveman.git#<commit>"
  ]
}
```

Replace `<commit>` with commit hash. Release tag can replace hash, for example
`#v0.1.0`. OpenCode loads TypeScript entrypoint directly; no build step needed.

Default upstream range:

```text
^2.7.0
```

So `2.7.x`, `2.8.0`, `2.9.x` match; `3.0.0` does not.

## Runtime model

```text
OpenCode startup
  -> load opencode-caveman
  -> list JuliusBrussee/caveman tags with `git ls-remote`
  -> select highest stable version matching configured semver range
  -> use peeled commit SHA for annotated tags, direct SHA for lightweight tags
  -> reuse matching immutable upstream cache or download commit archive from codeload.github.com
  -> validate upstream package + OpenCode installer contract
  -> read OpenCode payload lists from upstream bin/install.js
  -> load upstream OpenCode plugin/hooks/rules
  -> register upstream skills + commands in OpenCode V2
  -> sync upstream-declared Cavecrew agent markdown with ownership protection
  -> register optional Caveman MCP from same cached upstream source tree
  -> run
```

No periodic updater. No CI-generated Caveman snapshot. No copied upstream content in repository or install.

Git must be installed. Version discovery uses Git transport, not GitHub REST API. Cache avoids downloading same immutable commit again and allows offline rollback. Startup still checks upstream tags every time. If Git tag lookup or codeload archive download fails, last compatible cache is used and status reports stale cache.

## Configuration

Optional object form:

```json
{
  "plugins": [
    {
      "package": "opencode-caveman@git+https://github.com/rozsazoltan/opencode-caveman.git#<commit>",
      "options": {
        "upstreamRange": "^2.7.0",
        "upstreamRepository": "JuliusBrussee/caveman",
        "include": {
          "agents": true,
          "commands": true,
          "mcps": true,
          "skills": true
        },
        "cacheDirectory": "/absolute/path/to/.caveman"
      }
    }
  ]
}
```

`cacheDirectory` is optional and must be absolute. Default: `~/.cache/opencode/.caveman/`.

`nodeExecutable` selects command used to launch cached MCP entrypoint. When omitted, plugin probes `node` first, then `bun`, and uses first available runtime. Probe is bounded and launches no shell. If neither runtime is available, only Caveman MCP registration is skipped; plugin hooks, rules, skills, and commands remain active. Set `nodeExecutable` to force a runtime or command prefix. Simple strings such as `node` name one executable. Strings with whitespace are tokenized into argv; for example:

```json
"nodeExecutable": "mise exec -- node"
```

Quotes group tokens, such as `mise exec -- "node path/bin/node"`. An unquoted string containing `/` or `\` remains one executable, preserving paths with spaces. Quote command text that includes paths or use an array to avoid ambiguity.

Use a non-empty string array to provide an executable and fixed arguments. Arrays are most unambiguous:

```json
"nodeExecutable": ["mise", "exec", "--", "node"]
```

Both forms produce argv directly; no shell runs, and shell expansion does not occur. Explicit values bypass runtime detection. `mise` must be discoverable in the OpenCode server's `PATH`. OpenCode does not automatically source shell profiles such as `.bashrc`.

`include` independently controls upstream agents, commands, MCP, and skills. Every category defaults to `true`; only literal `false` disables a category. For example, set `"mcps": false` to disable only MCP registration. Disabling agents removes unchanged plugin-managed agent files and keeps modified files. `commands: false` also disables plugin management commands (`/caveman-upstream-status`, `/caveman-upstream-update`, and `/caveman-managed-clean`). Hooks and core rules remain active for every setting.

When enabled, MCP registration adds local server `caveman` using the selected runtime to launch `mcp/bin/caveman-mcp.mjs` from the cached, immutable upstream release source. Runtime fallback checks availability and runtime identity only. Bun fallback was smoke-tested against upstream Caveman 2.7.0, but upstream declares a Node.js engine, so compatibility with other upstream versions is not guaranteed. Registration is skipped with a diagnostic if launcher or generated installer files are missing or neither runtime is available. An existing `caveman` MCP server is preserved and never overwritten. No npm `caveman-mcp` dependency is used.

On first MCP start, upstream launcher downloads matching native binary, verifies signed checksum manifest and SHA-256, then caches binary under `~/.caveman/bin`. Native binary is licensed under BSL-1.1. MCP launcher and installer source come from the same resolved upstream commit as rest of integration.

## What comes from upstream

Wrapper does not hardcode Caveman payload content. Resolved upstream repo is authority.

It reads OpenCode payload lists from upstream `bin/install.js`:

```text
OPENCODE_SKILL_DIRS
OPENCODE_COMMAND_FILES
OPENCODE_AGENT_FILES
```

Then uses upstream files from same immutable commit, including:

```text
src/plugins/opencode/plugin.js
src/hooks/caveman-config.js
src/hooks/caveman-parse.js
src/rules/caveman-activate.md
src/plugins/opencode/commands/*
skills/*
agents/*
bin/lib/opencode-agent.js
```

Full upstream source tree stays in runtime cache, so skill-relative scripts/assets remain available. Wrapper repository contains none of them.

## OpenCode V2 bridge

Upstream Caveman OpenCode plugin currently exposes V1 hook map. Wrapper bridges it to V2:

```text
chat.message                        -> session.hook("prompt")
experimental.chat.system.transform -> session.hook("context")
event                               -> ctx.event.subscribe()
upstream Tier-3 rules              -> context + compaction hooks
```

Skills and commands register through V2 transforms.

OpenCode V2 `AgentEditor` can update/remove existing agents but cannot add new agents. Upstream Cavecrew agents therefore must be materialized under OpenCode config `agents/`. Wrapper copies only files declared by upstream installer and tracks hashes. Existing user-owned or locally modified files are never overwritten.

## Cache

Default:

```text
~/.cache/opencode/opencode-caveman/
```

Cache contains upstream source trees keyed by semantic version + commit SHA. This is runtime upstream cache, not vendored wrapper content.

## Commands

```text
/caveman-upstream-status
/caveman-upstream-update
/caveman-managed-clean
```

`/caveman-upstream-update` performs same immediate upstream resolution used at startup.

## Safety / compatibility

- stable Git tags only
- configured semver range enforced
- tags resolved to commit SHAs (annotated tags peeled)
- archive downloaded by immutable commit SHA
- active semantic-version Git tag move rejected
- archive size, extraction ratio, entry count, extracted size, symlink/hardlink guards
- package identity/version validated
- adapter contract validated before activation
- incompatible newer release rejected; last compatible cache kept
- cached release revalidated against current wrapper
- managed agent collision protection

Semver auto-follow trusts future upstream releases matching configured range. Use exact version such as `2.7.0` when review-before-update is required.

## Scope

Wrapper assembles upstream default OpenCode integration: mode/plugin behavior, rules, skills, commands, Cavecrew agents.

It can register optional Caveman MCP when enabled. It does not enable optional Caveman Engine/proxy/shrink binaries or `caveman enable opencode`. Those are separate upstream runtime/licensing surfaces.

## Development

```sh
bun install
bun run typecheck
bun run test
```

No GitHub Actions workflow required for runtime behavior.
