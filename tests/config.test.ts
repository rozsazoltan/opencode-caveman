import test from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_UPSTREAM_RANGE,
  DEFAULT_UPSTREAM_REPOSITORY,
  resolveOptions,
} from "../src/config.ts"

test("uses semver-tracked upstream defaults", () => {
  const options = resolveOptions({}, {})
  assert.equal(options.upstreamRange, DEFAULT_UPSTREAM_RANGE)
  assert.equal(options.upstreamRange, "^2.7.0")
  assert.equal(options.upstreamRepository, DEFAULT_UPSTREAM_REPOSITORY)
  assert.equal(options.upstreamRepository, "JuliusBrussee/caveman")
})

test("allows config and environment overrides", () => {
  const configured = resolveOptions({
    upstreamRange: "~2.8.0",
    upstreamRepository: "example/caveman",
  }, {})
  assert.equal(configured.upstreamRange, "~2.8.0")
  assert.equal(configured.upstreamRepository, "example/caveman")

  const env = resolveOptions({}, {
    OPENCODE_CAVEMAN_VERSION: "^2.9.0",
    OPENCODE_CAVEMAN_REPOSITORY: "fork/caveman",
    OPENCODE_CAVEMAN_GITHUB_TOKEN: "token",
  })
  assert.equal(env.upstreamRange, "^2.9.0")
  assert.equal(env.upstreamRepository, "fork/caveman")
  assert.equal(env.githubToken, "token")
})
