import { homedir } from "node:os"
import { join } from "node:path"

export function opencodeConfigDirectory(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (env.OPENCODE_CONFIG_DIR?.trim()) return env.OPENCODE_CONFIG_DIR
  if (env.XDG_CONFIG_HOME?.trim()) return join(env.XDG_CONFIG_HOME, "opencode")
  return join(home, ".config", "opencode")
}

export function pluginCacheDirectory(
  configuredDirectory?: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (configuredDirectory?.trim()) return configuredDirectory.trim()
  if (env.XDG_CACHE_HOME?.trim()) return join(env.XDG_CACHE_HOME, "opencode", ".caveman")
  if (process.platform === "win32" && env.LOCALAPPDATA?.trim()) {
    return join(env.LOCALAPPDATA, "opencode", ".caveman")
  }
  return join(home, ".cache", "opencode", ".caveman")
}
