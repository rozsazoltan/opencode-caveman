import { createRequire } from "node:module"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { basename, join } from "node:path"
import { atomicWrite, readJsonFile, sha256, writeJsonFile } from "./fs.ts"

interface ManagedAgent {
  path: string
  hash: string
}

interface AgentManifest {
  upstreamVersion: string
  agents: Record<string, ManagedAgent>
}

export interface AgentSyncResult {
  installed: number
  removed: number
  skipped: string[]
}

type AgentTransformer = (content: string) => string

function loadTransformer(root: string): AgentTransformer {
  const helper = join(root, "bin", "lib", "opencode-agent.js")
  if (!existsSync(helper)) return (content) => content
  const require = createRequire(import.meta.url)
  const loaded = require(helper) as { transformOpencodeAgentFrontmatter?: unknown }
  return typeof loaded.transformOpencodeAgentFrontmatter === "function"
    ? loaded.transformOpencodeAgentFrontmatter as AgentTransformer
    : (content) => content
}

function fileHash(path: string): string | undefined {
  try {
    return sha256(readFileSync(path))
  } catch {
    return undefined
  }
}

export function syncAgents(
  upstreamRoot: string,
  upstreamVersion: string,
  agentFiles: readonly string[],
  configRoot: string,
  cacheRoot: string,
): AgentSyncResult {
  const sourceRoot = join(upstreamRoot, "agents")
  const destinationRoot = join(configRoot, "agents")
  const manifestPath = join(cacheRoot, "managed-agents.json")
  const previous = readJsonFile<AgentManifest>(manifestPath) ?? { upstreamVersion: "", agents: {} }
  const next: AgentManifest = { upstreamVersion, agents: {} }
  const result: AgentSyncResult = { installed: 0, removed: 0, skipped: [] }

  mkdirSync(destinationRoot, { recursive: true })
  const transform = loadTransformer(upstreamRoot)

  for (const fileName of agentFiles) {
    const source = join(sourceRoot, fileName)
    if (!existsSync(source)) {
      result.skipped.push(`${fileName}: missing from Caveman ${upstreamVersion}`)
      continue
    }
    const destination = join(destinationRoot, basename(fileName))
    const content = transform(readFileSync(source, "utf8"))
    const newHash = sha256(content)
    const old = previous.agents[fileName]
    const existingHash = fileHash(destination)

    if (existingHash && existingHash !== newHash && (!old || existingHash !== old.hash)) {
      result.skipped.push(`${fileName}: existing file is not managed by opencode-caveman`)
      continue
    }

    atomicWrite(destination, content)
    next.agents[fileName] = { path: destination, hash: newHash }
    result.installed++
  }

  for (const [name, old] of Object.entries(previous.agents)) {
    if (next.agents[name]) continue
    const existingHash = fileHash(old.path)
    if (existingHash === old.hash) {
      rmSync(old.path, { force: true })
      result.removed++
    }
  }

  writeJsonFile(manifestPath, next)
  return result
}

export function removeManagedAgents(cacheRoot: string): AgentSyncResult {
  const manifestPath = join(cacheRoot, "managed-agents.json")
  const previous = readJsonFile<AgentManifest>(manifestPath)
  const result: AgentSyncResult = { installed: 0, removed: 0, skipped: [] }
  if (!previous) return result

  for (const [name, managed] of Object.entries(previous.agents)) {
    const existingHash = fileHash(managed.path)
    if (existingHash === managed.hash) {
      rmSync(managed.path, { force: true })
      result.removed++
    } else if (existingHash !== undefined) {
      result.skipped.push(`${name}: modified after installation`)
    }
  }
  rmSync(manifestPath, { force: true })
  return result
}
