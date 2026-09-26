# @rozsazoltan/opencode-caveman

Thin OpenCode V2 adapter for [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman).

Wrapper vendors **zero Caveman source, prompts, skills, agents, commands, rules, hooks, or binaries**.
Every plugin startup resolves configured Caveman semver range from upstream GitHub repository, pins selected release to immutable commit SHA, and assembles OpenCode integration from that upstream source tree.

## Install

```json
{
  "plugins": [
    "@rozsazoltan/opencode-caveman"
  ]
}
```

Default upstream range:

```text
^2.7.0
```

So `2.7.x`, `2.8.0`, `2.9.x` match; `3.0.0` does not.

## Runtime model

```text
OpenCode startup
  -> load @rozsazoltan/opencode-caveman
  -> query JuliusBrussee/caveman releases
  -> select highest stable version matching configured semver range
  -> dereference release tag to commit SHA
  -> reuse matching immutable upstream cache or download commit archive
  -> validate upstream package + OpenCode installer contract
  -> read OpenCode payload lists from upstream bin/install.js
  -> load upstream OpenCode plugin/hooks/rules
  -> register upstream skills + commands in OpenCode V2
  -> sync upstream-declared Cavecrew agent markdown with ownership protection
  -> run
```

No periodic updater. No CI-generated Caveman snapshot. No copied upstream content in npm package.

Cache exists only to avoid downloading same immutable commit again and to allow offline rollback. Startup still checks upstream every time. If GitHub unavailable, last compatible cache is used and status reports stale cache.

## Configuration

Optional object form:

```json
{
  "plugins": [
    {
      "package": "@rozsazoltan/opencode-caveman",
      "options": {
        "upstreamRange": "^2.7.0",
        "upstreamRepository": "JuliusBrussee/caveman"
      }
    }
  ]
}
```

Environment overrides:

```text
OPENCODE_CAVEMAN_VERSION
OPENCODE_CAVEMAN_REPOSITORY
OPENCODE_CAVEMAN_CACHE_DIR
OPENCODE_CAVEMAN_GITHUB_TOKEN
```

`OPENCODE_CAVEMAN_GITHUB_TOKEN` optional; used only for GitHub API/download requests.

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

Full upstream source tree stays in runtime cache, so skill-relative scripts/assets remain available. Wrapper repo/package contains none of them.

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

- stable GitHub releases only
- configured semver range enforced
- release tag dereferenced to commit SHA
- archive downloaded by immutable commit SHA
- active semantic-version tag move rejected
- archive size, extraction ratio, entry count, extracted size, symlink/hardlink guards
- package identity/version validated
- adapter contract validated before activation
- incompatible newer release rejected; last compatible cache kept
- cached release revalidated against current wrapper
- managed agent collision protection

Semver auto-follow trusts future upstream releases matching configured range. Use exact version such as `2.7.0` when review-before-update is required.

## Scope

Wrapper assembles upstream default OpenCode integration: mode/plugin behavior, rules, skills, commands, Cavecrew agents.

It does not enable optional Caveman Engine/proxy/MCP/shrink binaries or `caveman enable opencode`. Those are separate upstream runtime/licensing surfaces.

## Development

```bash
npm install
npm run typecheck
npm test
npm pack --dry-run
```

No GitHub Actions workflow required for runtime behavior.
