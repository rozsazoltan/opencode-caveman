import test from "node:test"
import assert from "node:assert/strict"
import {
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
})

test("uses only configured overrides", () => {
  const configured = resolveOptions({
    upstreamRange: "~2.8.0",
    upstreamRepository: "example/caveman",
    cacheDirectory: "/tmp/caveman-cache",
    githubToken: "test-token",
  })
  assert.equal(configured.upstreamRange, "~2.8.0")
  assert.equal(configured.upstreamRepository, "example/caveman")
  assert.equal(configured.cacheDirectory, "/tmp/caveman-cache")
  assert.equal(configured.githubToken, "test-token")
})
