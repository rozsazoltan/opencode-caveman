import { Plugin } from "@opencode/plugin"
import { appendFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { syncAgents, removeManagedAgents, type AgentSyncResult } from "./agents.ts"
import { installRuntimeBridge, type RuntimeSnapshot } from "./bridge.ts"
import { loadCatalog, type UpstreamCatalog } from "./catalog.ts"
import { resolveOptions } from "./config.ts"
import { opencodeConfigDirectory, pluginCacheDirectory } from "./paths.ts"
import { UpstreamManager } from "./upstream.ts"

const require = createRequire(import.meta.url)
const pluginPackage = require("../package.json") as { version: string }

function diagnosticLogger(cacheRoot: string): (message: string) => void {
  const path = join(cacheRoot, "opencode-caveman.log")
  return (message) => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      appendFileSync(path, `[${new Date().toISOString()}] ${message}\n`, "utf8")
    } catch {
      // Diagnostics must never break plugin startup or model calls.
    }
  }
}

export default Plugin.define({
  id: "opencode-caveman",
  async setup(ctx) {
    const options = resolveOptions(ctx.options)
    const cacheRoot = pluginCacheDirectory()
    const configRoot = opencodeConfigDirectory()
    const log = diagnosticLogger(cacheRoot)
    const manager = new UpstreamManager({
      range: options.upstreamRange,
      repository: options.upstreamRepository,
      cacheRoot,
      githubToken: options.githubToken,
    })

    let snapshot: RuntimeSnapshot | undefined
    let registriesReady = false

    const refresh = async (): Promise<RuntimeSnapshot> => {
      let candidateCatalog: UpstreamCatalog | undefined
      const install = await manager.ensure(async (root, version) => {
        // New upstream becomes active only after complete OpenCode adapter contract loads.
        candidateCatalog = await loadCatalog(root, version)
      })

      const versionChanged = snapshot?.install.commit !== install.commit
      const catalog = candidateCatalog && candidateCatalog.version === install.version
        ? candidateCatalog
        : versionChanged || snapshot === undefined
          ? await loadCatalog(install.root, install.version)
          : snapshot.catalog

      // OpenCode V2 AgentEditor cannot add new agents. Materialize only upstream-declared
      // agent markdown into OpenCode config, with ownership hashes and collision protection.
      const agents = syncAgents(
        install.root,
        install.version,
        catalog.agentFiles,
        configRoot,
        cacheRoot,
      )

      snapshot = {
        install,
        catalog,
        agents,
        refreshedAt: new Date().toISOString(),
      }

      if (registriesReady && versionChanged) {
        await Promise.all([
          ctx.skill.reload(),
          ctx.command.reload(),
          ctx.agent.reload(),
        ])
      } else if (registriesReady) {
        await ctx.agent.reload()
      }

      if (install.warning) log(`Upstream refresh using cache: ${install.warning}`)
      for (const warning of agents.skipped) log(`Agent sync skipped: ${warning}`)
      return snapshot
    }

    // Always resolve configured semver range from upstream repository on plugin startup.
    // Cache is only immutable source storage and offline rollback, never update authority.
    snapshot = await refresh()

    const getSnapshot = (): RuntimeSnapshot => {
      if (!snapshot) throw new Error("OpenCode Caveman runtime is not initialized")
      return snapshot
    }

    const cleanAgents = async (): Promise<AgentSyncResult> => {
      const result = removeManagedAgents(cacheRoot)
      await ctx.agent.reload()
      return result
    }

    const disposeBridge = await installRuntimeBridge(ctx, {
      getSnapshot,
      refresh,
      cleanAgents,
      pluginVersion: pluginPackage.version,
      diagnostic: log,
    })
    registriesReady = true

    return disposeBridge
  },
})
