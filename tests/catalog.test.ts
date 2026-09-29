import test from "node:test"
import assert from "node:assert/strict"
import { parseFrontmatter, parseInstallerArray, renderCommand } from "../src/catalog.ts"

test("parses folded YAML description", () => {
  const parsed = parseFrontmatter(`---\nname: caveman\ndescription: >\n  terse mode\n  keeps detail\n---\nBody\n`)
  assert.equal(parsed.attributes.name, "caveman")
  assert.equal(parsed.attributes.description, "terse mode keeps detail\n")
  assert.equal(parsed.body, "Body\n")
})

test("reads OpenCode payload list from upstream installer source", () => {
  const source = `const OPENCODE_SKILL_DIRS = ['caveman', 'cavecrew'];\n`
  assert.deepEqual(parseInstallerArray(source, "OPENCODE_SKILL_DIRS"), ["caveman", "cavecrew"])
})

test("fails when upstream installer contract disappears", () => {
  assert.throws(
    () => parseInstallerArray("const OTHER = ['x'];", "OPENCODE_SKILL_DIRS"),
    /does not define OPENCODE_SKILL_DIRS/,
  )
})

test("renders command arguments without changing other content", () => {
  assert.equal(renderCommand("Activate: $ARGUMENTS\n", " full "), "Activate: full\n")
})
