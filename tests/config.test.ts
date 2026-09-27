import test from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_NODE_EXECUTABLE,
  DEFAULT_UPSTREAM_RANGE,
  DEFAULT_UPSTREAM_REPOSITORY,
  resolveOptions,
} from "../src/config.ts"

test("uses semver-tracked upstream defaults", () => {
  const options = resolveOptions({})
  assert.equal(options.upstreamRange, DEFAULT_UPSTREAM_RANGE)
  assert.equal(options.upstreamRange, "^2.7.0")
  assert.equal(options.upstreamRepository, DEFAULT_UPSTREAM_REPOSITORY)
  assert.equal(options.upstreamRepository, "JuliusBrussee/caveman")
  assert.equal(options.nodeExecutable, DEFAULT_NODE_EXECUTABLE)
  assert.equal(options.nodeExecutable, "node")
  assert.deepEqual(options.include, {
    agents: true,
    commands: true,
    mcps: true,
    skills: true,
  })
})

test("uses only configured overrides", () => {
  const configured = resolveOptions({
    upstreamRange: "~2.8.0",
    upstreamRepository: "example/caveman",
    nodeExecutable: "/opt/node/bin/node",
    cacheDirectory: "/tmp/caveman-cache",
  })
  assert.equal(configured.upstreamRange, "~2.8.0")
  assert.equal(configured.upstreamRepository, "example/caveman")
  assert.equal(configured.nodeExecutable, "/opt/node/bin/node")
  assert.equal(configured.cacheDirectory, "/tmp/caveman-cache")
})

test("independently disables only categories set to false", () => {
  assert.deepEqual(resolveOptions({ include: { agents: false } }).include, {
    agents: false,
    commands: true,
    mcps: true,
    skills: true,
  })
  assert.deepEqual(resolveOptions({ include: { commands: false } }).include, {
    agents: true,
    commands: false,
    mcps: true,
    skills: true,
  })
  assert.deepEqual(resolveOptions({ include: { mcps: false } }).include, {
    agents: true,
    commands: true,
    mcps: false,
    skills: true,
  })
  assert.deepEqual(resolveOptions({ include: { skills: false } }).include, {
    agents: true,
    commands: true,
    mcps: true,
    skills: false,
  })
  assert.equal(resolveOptions({ include: { skills: 0, agents: null } }).include.skills, true)
  assert.equal(resolveOptions({ include: null }).include.agents, true)
})
