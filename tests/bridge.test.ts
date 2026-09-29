import test from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  installRuntimeBridge,
  registerCavemanMcp,
  type PluginContext,
  type RuntimeSnapshot,
} from "../src/bridge.ts"
import type { IncludeOptions } from "../src/config.ts"

async function installedTransforms(
  include: IncludeOptions,
  snapshot: RuntimeSnapshot = {} as RuntimeSnapshot,
  mcpServers?: Map<string, unknown>,
  diagnostic?: (message: string) => void,
  nodeExecutable: string | string[] = "node",
): Promise<{ transforms: string[]; hooks: string[] }> {
  const transforms: string[] = []
  const hooks: string[] = []
  const registration = { dispose: async () => {} }
  const ctx = {
    location: { directory: "/workspace", workspaceID: "workspace" },
    skill: { transform: async () => { transforms.push("skills"); return registration } },
    command: { transform: async () => { transforms.push("commands"); return registration } },
    mcp: {
      transform: async (apply: (editor: {
        get(name: string): unknown
        set(name: string, config: { type: "local"; command: string[] }): void
      }) => void) => {
        transforms.push("mcps")
        if (mcpServers) {
          apply({
            get: (name) => mcpServers.get(name),
            set: (name, config) => mcpServers.set(name, config),
          })
        }
        return registration
      },
    },
    session: {
      hook: async (name: string) => { hooks.push(name); return registration },
      prompt: async () => {},
    },
    event: { subscribe: () => (async function* () {})() },
  } as unknown as PluginContext

  const dispose = await installRuntimeBridge(ctx, {
    getSnapshot: () => snapshot,
    refresh: async () => snapshot,
    cleanAgents: async () => ({ installed: 0, removed: 0, skipped: [] }),
    include,
    nodeExecutable,
    pluginVersion: "test",
    diagnostic,
  })
  await dispose()
  return { transforms, hooks }
}

test("registers Caveman MCP from cached upstream source", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "opencode-caveman-mcp-"))
  try {
    const upstreamRoot = join(tempRoot, "versions", "2.7.0-0123456789abcdef")
    const binDirectory = join(upstreamRoot, "mcp", "bin")
    mkdirSync(binDirectory, { recursive: true })
    writeFileSync(join(binDirectory, "caveman-mcp.mjs"), "")
    writeFileSync(join(binDirectory, "binary-installer.generated.mjs"), "")
    writeFileSync(join(binDirectory, "release.generated.mjs"), "")

    const servers = new Map<string, unknown>()
    const snapshot = { install: { root: upstreamRoot } } as RuntimeSnapshot
    const include: IncludeOptions = { agents: true, commands: true, mcps: true, skills: true }
    const { transforms } = await installedTransforms(include, snapshot, servers)

    assert.equal(transforms.includes("mcps"), true)
    assert.deepEqual(servers.get("caveman"), {
      type: "local",
      command: ["node", join(upstreamRoot, "mcp", "bin", "caveman-mcp.mjs")],
    })
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test("uses configured Node executable for Caveman MCP", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "opencode-caveman-mcp-"))
  try {
    const upstreamRoot = join(tempRoot, "versions", "2.7.0-0123456789abcdef")
    const binDirectory = join(upstreamRoot, "mcp", "bin")
    mkdirSync(binDirectory, { recursive: true })
    writeFileSync(join(binDirectory, "caveman-mcp.mjs"), "")
    writeFileSync(join(binDirectory, "binary-installer.generated.mjs"), "")
    writeFileSync(join(binDirectory, "release.generated.mjs"), "")

    const servers = new Map<string, unknown>()
    const snapshot = { install: { root: upstreamRoot } } as RuntimeSnapshot
    const include: IncludeOptions = { agents: true, commands: true, mcps: true, skills: true }
    await installedTransforms(include, snapshot, servers, undefined, "/opt/node with spaces/bin/node")

    assert.deepEqual(servers.get("caveman"), {
      type: "local",
      command: ["/opt/node with spaces/bin/node", join(upstreamRoot, "mcp", "bin", "caveman-mcp.mjs")],
    })
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test("uses configured argv prefix for Caveman MCP", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "opencode-caveman-mcp-"))
  try {
    const upstreamRoot = join(tempRoot, "versions", "2.7.0-0123456789abcdef")
    const binDirectory = join(upstreamRoot, "mcp", "bin")
    mkdirSync(binDirectory, { recursive: true })
    writeFileSync(join(binDirectory, "caveman-mcp.mjs"), "")
    writeFileSync(join(binDirectory, "binary-installer.generated.mjs"), "")
    writeFileSync(join(binDirectory, "release.generated.mjs"), "")

    const servers = new Map<string, unknown>()
    const snapshot = { install: { root: upstreamRoot } } as RuntimeSnapshot
    const include: IncludeOptions = { agents: true, commands: true, mcps: true, skills: true }
    await installedTransforms(include, snapshot, servers, undefined, ["mise", "exec", "--", "node"])

    assert.deepEqual(servers.get("caveman"), {
      type: "local",
      command: ["mise", "exec", "--", "node", join(upstreamRoot, "mcp", "bin", "caveman-mcp.mjs")],
    })
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test("skips Caveman MCP registration when an upstream launcher file is missing", () => {
  for (const missingFile of [
    "caveman-mcp.mjs",
    "binary-installer.generated.mjs",
    "release.generated.mjs",
  ]) {
    const tempRoot = mkdtempSync(join(tmpdir(), "opencode-caveman-mcp-"))
    try {
      const upstreamRoot = join(tempRoot, "versions", "2.7.0-0123456789abcdef")
      const binDirectory = join(upstreamRoot, "mcp", "bin")
      mkdirSync(binDirectory, { recursive: true })
      for (const file of [
        "caveman-mcp.mjs",
        "binary-installer.generated.mjs",
        "release.generated.mjs",
      ]) {
        if (file !== missingFile) writeFileSync(join(binDirectory, file), "")
      }

      const servers = new Map<string, unknown>()
      const diagnostics: string[] = []
      const registered = registerCavemanMcp({
        get: (name) => servers.get(name),
        set: (name, config) => servers.set(name, config),
      }, upstreamRoot, (message) => diagnostics.push(message))

      assert.equal(registered, false)
      assert.equal(servers.has("caveman"), false)
      assert.equal(diagnostics.length, 1)
      assert.match(diagnostics[0]!, new RegExp(`mcp/bin/${missingFile.replaceAll(".", "\\.")}`))
      assert.match(diagnostics[0]!, /select an upstream release|include\.mcps/)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  }
})

test("preserves existing user Caveman MCP server", () => {
  const existing = { type: "local", command: ["user", "server"] }
  const servers = new Map<string, unknown>([["caveman", existing]])
  const registered = registerCavemanMcp({
    get: (name) => servers.get(name),
    set: (name, config) => servers.set(name, config),
  }, "/missing/upstream")

  assert.equal(registered, false)
  assert.equal(servers.get("caveman"), existing)
})

test("include.mcps false skips MCP registration", async () => {
  const include: IncludeOptions = { agents: true, commands: true, mcps: false, skills: true }
  const servers = new Map<string, unknown>()
  const { transforms } = await installedTransforms(include, {} as RuntimeSnapshot, servers)

  assert.equal(transforms.includes("mcps"), false)
  assert.equal(servers.has("caveman"), false)
})

test("each include switch disables only its registry transform", async () => {
  const categories = ["agents", "commands", "mcps", "skills"] as const
  const transformNames = { agents: undefined, commands: "commands", mcps: "mcps", skills: "skills" } as const

  for (const category of categories) {
    const include: IncludeOptions = {
      agents: true,
      commands: true,
      mcps: true,
      skills: true,
      [category]: false,
    }
    const { transforms, hooks } = await installedTransforms(include)

    assert.deepEqual(
      transforms,
      ["skills", "commands", "mcps"].filter((name) => name !== transformNames[category]),
      `${category} switch should only disable its own registration`,
    )
    assert.deepEqual(hooks, ["prompt", "context", "compaction"])
  }
})
