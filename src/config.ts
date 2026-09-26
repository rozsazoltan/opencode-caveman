export const DEFAULT_UPSTREAM_RANGE = "^2.7.0"
export const DEFAULT_UPSTREAM_REPOSITORY = "JuliusBrussee/caveman"

export type PluginOptions = Readonly<Record<string, unknown>>

export interface ResolvedOptions {
  upstreamRange: string
  upstreamRepository: string
  githubToken?: string
}

function stringOption(options: PluginOptions, key: string): string | undefined {
  const value = options[key]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

export function resolveOptions(
  options: PluginOptions,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedOptions {
  return {
    upstreamRange:
      stringOption(options, "upstreamRange") ??
      env.OPENCODE_CAVEMAN_VERSION ??
      DEFAULT_UPSTREAM_RANGE,
    upstreamRepository:
      stringOption(options, "upstreamRepository") ??
      env.OPENCODE_CAVEMAN_REPOSITORY ??
      DEFAULT_UPSTREAM_REPOSITORY,
    githubToken:
      typeof env.OPENCODE_CAVEMAN_GITHUB_TOKEN === "string" && env.OPENCODE_CAVEMAN_GITHUB_TOKEN.length > 0
        ? env.OPENCODE_CAVEMAN_GITHUB_TOKEN
        : undefined,
  }
}
