import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { syncAgents } from "../src/agents.ts"

test("syncs only upstream-listed agents and refuses user-owned collision", () => {
  const root = mkdtempSync(join(tmpdir(), "opencode-caveman-agents-"))
  const upstream = join(root, "upstream")
  const config = join(root, "config")
  const cache = join(root, "cache")
  mkdirSync(join(upstream, "agents"), { recursive: true })
  writeFileSync(join(upstream, "agents", "managed.md"), "managed\n")
  writeFileSync(join(upstream, "agents", "not-listed.md"), "not listed\n")
  mkdirSync(join(config, "agents"), { recursive: true })
  writeFileSync(join(config, "agents", "managed.md"), "user-owned\n")

  const result = syncAgents(upstream, "2.7.0", ["managed.md"], config, cache)
  assert.equal(result.installed, 0)
  assert.equal(result.skipped.length, 1)
  assert.equal(readFileSync(join(config, "agents", "managed.md"), "utf8"), "user-owned\n")
  assert.throws(() => readFileSync(join(config, "agents", "not-listed.md"), "utf8"))
})
