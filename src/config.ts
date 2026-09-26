export const DEFAULT_UPSTREAM_RANGE = "^2.7.0"
export const DEFAULT_UPSTREAM_REPOSITORY = "JuliusBrussee/caveman"

export type PluginOptions = Readonly<Record<string, unknown>>

export interface ResolvedOptions {
  upstreamRange: string
  upstreamRepository: string
  cacheDirectory?: string
  githubToken?: string
}

function stringOption(options: PluginOptions, key: string): string | undefined {
  const value = options[key]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

export function resolveOptions(options: PluginOptions): ResolvedOptions {
  return {
    upstreamRange: stringOption(options, "upstreamRange") ?? DEFAULT_UPSTREAM_RANGE,
    upstreamRepository: stringOption(options, "upstreamRepository") ?? DEFAULT_UPSTREAM_REPOSITORY,
    cacheDirectory: stringOption(options, "cacheDirectory"),
    githubToken: stringOption(options, "githubToken"),
  }
}
