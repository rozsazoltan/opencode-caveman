import test from "node:test"
import assert from "node:assert/strict"
import { createRuntimeSelector } from "../src/runtime.ts"

test("selects Node before Bun when both runtimes are available", () => {
  const probes: string[] = []
  const selectRuntime = createRuntimeSelector((runtime) => {
    probes.push(runtime)
    return true
  })

  assert.equal(selectRuntime(), "node")
  assert.deepEqual(probes, ["node"])
})

test("falls back to Bun when Node probe fails", () => {
  const probes: string[] = []
  const selectRuntime = createRuntimeSelector((runtime) => {
    probes.push(runtime)
    return runtime === "bun"
  })

  assert.equal(selectRuntime(), "bun")
  assert.deepEqual(probes, ["node", "bun"])
})

test("returns no runtime when Node and Bun are unavailable", () => {
  const probes: string[] = []
  const selectRuntime = createRuntimeSelector((runtime) => {
    probes.push(runtime)
    return false
  })

  assert.equal(selectRuntime(), undefined)
  assert.deepEqual(probes, ["node", "bun"])
})

test("treats probe errors as unavailable and caches selection result", () => {
  const probes: string[] = []
  const selectRuntime = createRuntimeSelector((runtime) => {
    probes.push(runtime)
    if (runtime === "node") throw new Error("probe failed")
    return false
  })

  assert.equal(selectRuntime(), undefined)
  assert.equal(selectRuntime(), undefined)
  assert.deepEqual(probes, ["node", "bun"])
})
