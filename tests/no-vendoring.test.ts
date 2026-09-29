import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

test("wrapper repository contains no vendored Caveman payload directories", () => {
  for (const path of ["skills", "agents", "commands", "src/hooks", "src/plugins/opencode"]) {
    assert.equal(existsSync(join(root, path)), false, `${path} must come from upstream runtime source`)
  }
})

test("wrapper package has no Caveman runtime dependency", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>
  }
  const dependencies = Object.keys(pkg.dependencies ?? {})
  assert.equal(dependencies.some((name) => name === "caveman-installer" || name.startsWith("@caveman-ai/")), false)
})
