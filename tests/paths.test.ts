import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { pluginCacheDirectory } from "../src/paths.ts"

test("uses configured cache directory before platform defaults", () => {
  assert.equal(
    pluginCacheDirectory("/configured/cache", { XDG_CACHE_HOME: "/xdg" }, "/home/test"),
    "/configured/cache",
  )
})

test("ignores plugin-specific environment overrides", () => {
  assert.equal(
    pluginCacheDirectory(undefined, { OPENCODE_CAVEMAN_CACHE_DIR: "/ignored" }, "/home/test"),
    join("/home/test", ".cache", "opencode", ".caveman"),
  )
})

test("uses the home cache instead of LOCALAPPDATA", () => {
  assert.equal(
    pluginCacheDirectory(undefined, { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" }, "/home/test"),
    join("/home/test", ".cache", "opencode", ".caveman"),
  )
})
