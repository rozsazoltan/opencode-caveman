import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeManagedAgents, syncAgents } from "../src/agents.ts"

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

test("removes unchanged managed agents but preserves modified files", () => {
  const root = mkdtempSync(join(tmpdir(), "opencode-caveman-agents-clean-"))
  const upstream = join(root, "upstream")
  const config = join(root, "config")
  const cache = join(root, "cache")
  mkdirSync(join(upstream, "agents"), { recursive: true })
  mkdirSync(join(config, "agents"), { recursive: true })
  writeFileSync(join(upstream, "agents", "unchanged.md"), "unchanged\n")
  writeFileSync(join(upstream, "agents", "modified.md"), "original\n")
  syncAgents(upstream, "2.7.0", ["unchanged.md", "modified.md"], config, cache)
  writeFileSync(join(config, "agents", "modified.md"), "user edit\n")

  const result = removeManagedAgents(cache)
  assert.equal(result.removed, 1)
  assert.deepEqual(result.skipped, ["modified.md: modified after installation"])
  assert.throws(() => readFileSync(join(config, "agents", "unchanged.md"), "utf8"))
  assert.equal(readFileSync(join(config, "agents", "modified.md"), "utf8"), "user edit\n")
})
