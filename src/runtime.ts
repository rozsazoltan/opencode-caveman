import { execFileSync } from "node:child_process"
import { PREFERRED_NODE_EXECUTABLE } from "./config.ts"

export type AutoRuntime = "node" | "bun"
export type RuntimeProbe = (runtime: AutoRuntime) => boolean
export type RuntimeSelector = () => AutoRuntime | undefined

const RUNTIME_PROBE_TIMEOUT_MS = 1_500

const runtimeExpressions: Record<AutoRuntime, string> = {
  node: `typeof process.versions.bun === "undefined" && typeof process.versions.node === "string" ? "node" : ""`,
  bun: `typeof process.versions.bun === "string" ? "bun" : ""`,
}

export function probeRuntime(runtime: AutoRuntime): boolean {
  try {
    const output = execFileSync(runtime, ["-p", runtimeExpressions[runtime]], {
      encoding: "utf8",
      maxBuffer: 1_024,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: RUNTIME_PROBE_TIMEOUT_MS,
      windowsHide: true,
    })
    return output.trim() === runtime
  } catch {
    return false
  }
}

export function createRuntimeSelector(probe: RuntimeProbe = probeRuntime): RuntimeSelector {
  let resolved = false
  let selected: AutoRuntime | undefined

  return () => {
    if (resolved) return selected
    resolved = true

    const candidates: AutoRuntime[] = [PREFERRED_NODE_EXECUTABLE, "bun"]
    for (const candidate of candidates) {
      let available = false
      try {
        available = probe(candidate)
      } catch {
        // A failed probe must not prevent checking the next supported runtime.
      }
      if (available) {
        selected = candidate
        break
      }
    }

    return selected
  }
}
