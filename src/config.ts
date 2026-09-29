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

function tokenizeCommandText(value: string): string[] | undefined {
  const tokens: string[] = []
  let token = ""
  let tokenStarted = false
  let quote: "'" | '"' | undefined

  for (const character of value) {
    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined
      } else {
        token += character
      }
      tokenStarted = true
      continue
    }

    if (character === "'" || character === '"') {
      quote = character
      tokenStarted = true
    } else if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token)
        token = ""
        tokenStarted = false
      }
    } else {
      token += character
      tokenStarted = true
    }
  }

  if (quote !== undefined) return undefined
  if (tokenStarted) tokens.push(token)
  return tokens.length > 0 ? tokens : undefined
}

function nodeExecutableOption(options: PluginOptions): NodeExecutable | undefined {
  const value = options.nodeExecutable
  if (typeof value === "string") {
    const commandText = value.trim()
    if (commandText.length === 0) return undefined

    // Keep unquoted paths as one executable so spaces in path names remain intact.
    if (!/["']/.test(commandText) && /[\\/]/.test(commandText)) return commandText

    const tokens = tokenizeCommandText(commandText)
    if (!tokens || tokens[0]!.trim().length === 0) return undefined
    return tokens.length === 1 ? tokens[0]! : tokens
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
