export const DEFAULT_NODE_EXECUTABLE = "node"
export const DEFAULT_UPSTREAM_RANGE = "^2.7.0"
export const DEFAULT_UPSTREAM_REPOSITORY = "JuliusBrussee/caveman"

export type NodeExecutable = string | string[]
export type PluginOptions = Readonly<Record<string, unknown>>

export interface IncludeOptions {
  agents: boolean
  commands: boolean
  mcps: boolean
  skills: boolean
}

export interface ResolvedOptions {
  upstreamRange: string
  upstreamRepository: string
  nodeExecutable: NodeExecutable
  cacheDirectory?: string
  include: IncludeOptions
}

function stringOption(options: PluginOptions, key: string): string | undefined {
  const value = options[key]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function nodeExecutableOption(options: PluginOptions): NodeExecutable | undefined {
  const value = options.nodeExecutable
  if (typeof value === "string") {
    return value.trim().length > 0 ? value.trim() : undefined
  }
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((part): part is string => typeof part === "string") &&
    value[0]!.trim().length > 0
  ) {
    return [value[0]!.trim(), ...value.slice(1)]
  }
  return undefined
}

function includeOptions(options: PluginOptions): IncludeOptions {
  const value = options.include
  const configured = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  return {
    agents: configured.agents !== false,
    commands: configured.commands !== false,
    mcps: configured.mcps !== false,
    skills: configured.skills !== false,
  }
}

export function resolveOptions(options: PluginOptions): ResolvedOptions {
  return {
    upstreamRange: stringOption(options, "upstreamRange") ?? DEFAULT_UPSTREAM_RANGE,
    upstreamRepository: stringOption(options, "upstreamRepository") ?? DEFAULT_UPSTREAM_REPOSITORY,
    nodeExecutable: nodeExecutableOption(options) ?? DEFAULT_NODE_EXECUTABLE,
    cacheDirectory: stringOption(options, "cacheDirectory"),
    include: includeOptions(options),
  }
}
