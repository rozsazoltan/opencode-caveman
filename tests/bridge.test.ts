import test from "node:test"
import assert from "node:assert/strict"
import {
  installRuntimeBridge,
  registerCavemanMcp,
  type PluginContext,
  type RuntimeSnapshot,
} from "../src/bridge.ts"
import type { IncludeOptions } from "../src/config.ts"

async function installedTransforms(include: IncludeOptions): Promise<{ transforms: string[]; hooks: string[] }> {
  const transforms: string[] = []
  const hooks: string[] = []
  const registration = { dispose: async () => {} }
  const ctx = {
    location: { directory: "/workspace", workspaceID: "workspace" },
    skill: { transform: async () => { transforms.push("skills"); return registration } },
    command: { transform: async () => { transforms.push("commands"); return registration } },
    mcp: { transform: async () => { transforms.push("mcps"); return registration } },
    session: {
      hook: async (name: string) => { hooks.push(name); return registration },
      prompt: async () => {},
    },
    event: { subscribe: () => (async function* () {})() },
  } as unknown as PluginContext

  const snapshot = {} as RuntimeSnapshot
  const dispose = await installRuntimeBridge(ctx, {
    getSnapshot: () => snapshot,
    refresh: async () => snapshot,
    cleanAgents: async () => ({ installed: 0, removed: 0, skipped: [] }),
    include,
    pluginVersion: "test",
  })
  await dispose()
  return { transforms, hooks }
}

test("registers Caveman MCP server with npx command", () => {
  const servers = new Map<string, unknown>()
  const registered = registerCavemanMcp({
    get: (name) => servers.get(name),
    set: (name, config) => servers.set(name, config),
  })

  assert.equal(registered, true)
  assert.deepEqual(servers.get("caveman"), {
    type: "local",
    command: ["npx", "-y", "caveman-mcp"],
  })
})

test("preserves existing user Caveman MCP server", () => {
  const existing = { type: "local", command: ["user", "server"] }
  const servers = new Map<string, unknown>([["caveman", existing]])
  const registered = registerCavemanMcp({
    get: (name) => servers.get(name),
    set: (name, config) => servers.set(name, config),
  })

  assert.equal(registered, false)
  assert.equal(servers.get("caveman"), existing)
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
