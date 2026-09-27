import test from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as tar from "tar"
import { resolveRelease, UpstreamManager, type GitTagRunner } from "../src/upstream.ts"

const commits: Record<string, string> = {
  "2.7.0": "1111111111111111111111111111111111111111",
  "2.8.0": "2222222222222222222222222222222222222222",
  "3.0.0": "3333333333333333333333333333333333333333",
}

const repositoryUrl = "https://github.com/JuliusBrussee/caveman.git"

function gitTagListing(
  versions: string[],
  commitOverride: Partial<Record<string, string>> = {},
): string {
  return versions.map((version) => {
    const commit = commitOverride[version] ?? commits[version]
    assert.ok(commit, `missing fixture commit for ${version}`)
    return `${commit}\trefs/tags/v${version}`
  }).join("\n") + "\n"
}

async function packageTarball(version: string): Promise<Buffer> {
  const root = mkdtempSync(join(tmpdir(), `opencode-caveman-${version}-`))
  const packageRoot = join(root, `caveman-${version}`)
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
    name: "caveman-installer",
    version,
  }))
  const archive = join(root, "source.tgz")
  await tar.c({ cwd: root, gzip: true, file: archive }, [`caveman-${version}`])
  return readFileSync(archive)
}

function upstreamFixture(
  tarballs: Map<string, Buffer>,
  getAvailable: () => string[],
  getCommitOverride: () => Partial<Record<string, string>> = () => ({}),
): { fetchImpl: typeof fetch; gitTagRunner: GitTagRunner } {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input)
    const sha = /\/tar\.gz\/([0-9a-f]{40,64})$/i.exec(url)?.[1]
    if (!url.startsWith("https://codeload.github.com/") || !sha) {
      return new Response("unexpected URL", { status: 404 })
    }
    const commitOverride = getCommitOverride()
    const version = Object.entries({ ...commits, ...commitOverride })
      .find(([, commit]) => commit === sha)?.[0]
    const bytes = version ? tarballs.get(version) : undefined
    return bytes
      ? new Response(new Uint8Array(bytes), { status: 200, headers: { "content-length": String(bytes.byteLength) } })
      : new Response("missing", { status: 404 })
  }
  const gitTagRunner: GitTagRunner = async (url) => {
    assert.equal(url, repositoryUrl)
    return gitTagListing(getAvailable(), getCommitOverride())
  }
  return { fetchImpl, gitTagRunner }
}

test("resolves highest stable matching Git tag and pins annotated or lightweight commit", async () => {
  const annotatedTagObject = "4444444444444444444444444444444444444444"
  const peeledCommit = commits["2.8.0"]!
  const output = [
    `${commits["2.7.0"]}\trefs/tags/v2.7.0`,
    `${annotatedTagObject}\trefs/tags/v2.8.0`,
    `${peeledCommit}\trefs/tags/v2.8.0^{}`,
    `5555555555555555555555555555555555555555\trefs/tags/v2.9.0-beta.1`,
    `${commits["3.0.0"]}\trefs/tags/v3.0.0`,
    `${commits["2.7.0"]}\trefs/tags/bin-v1.1.7`,
  ].join("\n")
  const release = await resolveRelease("^2.7.0", "JuliusBrussee/caveman", async (url) => {
    assert.equal(url, repositoryUrl)
    return output
  })

  assert.equal(release.version, "2.8.0")
  assert.equal(release.tag, "v2.8.0")
  assert.equal(release.commit, peeledCommit)
  assert.equal(release.tarball, `https://codeload.github.com/JuliusBrussee/caveman/tar.gz/${peeledCommit}`)

  const lightweight = await resolveRelease("2.7.0", "JuliusBrussee/caveman", async () =>
    `${commits["2.7.0"]}\trefs/tags/v2.7.0\n`)
  assert.equal(lightweight.commit, commits["2.7.0"])
})

test("keeps last compatible cache when newer matching tag fails adapter validation", async () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "opencode-caveman-cache-"))
  const tarballs = new Map<string, Buffer>([
    ["2.7.0", await packageTarball("2.7.0")],
    ["2.8.0", await packageTarball("2.8.0")],
  ])
  let available = ["2.7.0"]
  const fixture = upstreamFixture(tarballs, () => available)

  const manager = new UpstreamManager({
    range: "^2.7.0",
    repository: "JuliusBrussee/caveman",
    cacheRoot,
    ...fixture,
  })

  const first = await manager.ensure(async (_root, version) => {
    assert.equal(version, "2.7.0")
  })
  assert.equal(first.version, "2.7.0")
  assert.equal(first.stale, false)

  available = ["2.7.0", "2.8.0"]
  const second = await manager.ensure(async (_root, version) => {
    if (version === "2.8.0") throw new Error("unsupported upstream shape")
  })

  assert.equal(second.version, "2.7.0")
  assert.equal(second.stale, true)
  assert.match(second.warning ?? "", /2\.8\.0 adapter compatibility check failed/)
})

test("uses stale compatible cache when Git tag lookup fails", async () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "opencode-caveman-cache-git-failure-"))
  const tarballs = new Map<string, Buffer>([["2.7.0", await packageTarball("2.7.0")]])
  const fixture = upstreamFixture(tarballs, () => ["2.7.0"])
  let failLookup = false
  const gitTagRunner: GitTagRunner = async (url) => {
    if (failLookup) throw new Error("simulated Git transport failure")
    return fixture.gitTagRunner(url)
  }
  const manager = new UpstreamManager({
    range: "^2.7.0",
    repository: "JuliusBrussee/caveman",
    cacheRoot,
    fetchImpl: fixture.fetchImpl,
    gitTagRunner,
  })

  const first = await manager.ensure()
  failLookup = true
  const second = await manager.ensure()

  assert.equal(second.version, first.version)
  assert.equal(second.root, first.root)
  assert.equal(second.stale, true)
  assert.match(second.warning ?? "", /simulated Git transport failure/)
})

test("revalidates cache and checks upstream on every startup", async () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "opencode-caveman-cache-revalidate-"))
  const tarballs = new Map<string, Buffer>([["2.7.0", await packageTarball("2.7.0")]])
  let gitCalls = 0
  const fixture = upstreamFixture(tarballs, () => ["2.7.0"])
  const gitTagRunner: GitTagRunner = async (url) => {
    gitCalls++
    return fixture.gitTagRunner(url)
  }

  const manager = new UpstreamManager({
    range: "^2.7.0",
    repository: "JuliusBrussee/caveman",
    cacheRoot,
    fetchImpl: fixture.fetchImpl,
    gitTagRunner,
  })

  await manager.ensure(async () => undefined)
  assert.equal(gitCalls, 1)

  await assert.rejects(
    manager.ensure(async () => {
      throw new Error("wrapper contract changed")
    }),
    /Cached Caveman 2\.7\.0 is incompatible.*adapter compatibility check failed.*wrapper contract changed/,
  )
  assert.equal(gitCalls, 2, "startup must resolve upstream even when cache exists")
})

test("refuses silent replacement when an existing tag moves", async () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "opencode-caveman-cache-tag-move-"))
  const tarballs = new Map<string, Buffer>([["2.7.0", await packageTarball("2.7.0")]])
  let moved = false
  const movedCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  const fixture = upstreamFixture(tarballs, () => ["2.7.0"], () =>
    moved ? { "2.7.0": movedCommit } : {})

  const manager = new UpstreamManager({
    range: "^2.7.0",
    repository: "JuliusBrussee/caveman",
    cacheRoot,
    ...fixture,
  })

  await manager.ensure(async () => undefined)
  moved = true
  const second = await manager.ensure(async () => undefined)

  assert.equal(second.version, "2.7.0")
  assert.equal(second.commit, commits["2.7.0"])
  assert.equal(second.stale, true)
  assert.match(second.warning ?? "", /Git tag v2\.7\.0 moved/)
})
