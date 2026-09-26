import test from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as tar from "tar"
import { resolveRelease, UpstreamManager } from "../src/upstream.ts"

const commits: Record<string, string> = {
  "2.7.0": "1111111111111111111111111111111111111111",
  "2.8.0": "2222222222222222222222222222222222222222",
  "3.0.0": "3333333333333333333333333333333333333333",
}

function releaseList(versions: string[]) {
  return versions.map((version) => ({
    tag_name: `v${version}`,
    draft: false,
    prerelease: version.includes("-"),
  }))
}

test("^2.7.0 resolves highest stable 2.x GitHub release and pins commit", async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes("/releases?")) {
      return new Response(JSON.stringify([
        ...releaseList(["2.7.0", "2.8.0", "2.9.0-beta.1", "3.0.0"]),
        { tag_name: "bin-v1.1.7", draft: false, prerelease: false },
      ]), { status: 200 })
    }
    if (url.includes("/git/ref/tags/v2.8.0")) {
      return new Response(JSON.stringify({
        object: { type: "tag", sha: "4444444444444444444444444444444444444444" },
      }), { status: 200 })
    }
    if (url.includes("/git/tags/4444444444444444444444444444444444444444")) {
      return new Response(JSON.stringify({
        object: { type: "commit", sha: commits["2.8.0"] },
      }), { status: 200 })
    }
    return new Response("missing", { status: 404 })
  }

  const release = await resolveRelease(
    "^2.7.0",
    "JuliusBrussee/caveman",
    fakeFetch,
  )
  assert.equal(release.version, "2.8.0")
  assert.equal(release.tag, "v2.8.0")
  assert.equal(release.commit, commits["2.8.0"])
  assert.equal(release.tarball, `https://api.github.com/repos/JuliusBrussee/caveman/tarball/${commits["2.8.0"]}`)
})

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

function githubFetchFixture(
  tarballs: Map<string, Buffer>,
  getAvailable: () => string[],
  commitOverride: Partial<Record<string, string>> = {},
): typeof fetch {
  return async (input) => {
    const url = String(input)
    if (url.includes("/releases?")) {
      return new Response(JSON.stringify(releaseList(getAvailable())), { status: 200 })
    }
    const tag = /\/git\/ref\/tags\/v([^/?]+)/.exec(url)?.[1]
    if (tag) {
      const sha = commitOverride[tag] ?? commits[tag]
      return sha
        ? new Response(JSON.stringify({ object: { type: "commit", sha } }), { status: 200 })
        : new Response("missing", { status: 404 })
    }
    const sha = /\/tarball\/([0-9a-f]{40,64})$/i.exec(url)?.[1]
    if (sha) {
      const version = Object.entries({ ...commits, ...commitOverride })
        .find(([, commit]) => commit === sha)?.[0]
      const bytes = version ? tarballs.get(version) : undefined
      return bytes
        ? new Response(bytes, { status: 200, headers: { "content-length": String(bytes.byteLength) } })
        : new Response("missing", { status: 404 })
    }
    return new Response("missing", { status: 404 })
  }
}

test("keeps last compatible cache when newer matching release fails adapter validation", async () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "opencode-caveman-cache-"))
  const tarballs = new Map<string, Buffer>([
    ["2.7.0", await packageTarball("2.7.0")],
    ["2.8.0", await packageTarball("2.8.0")],
  ])
  let available = ["2.7.0"]
  const fakeFetch = githubFetchFixture(tarballs, () => available)

  const manager = new UpstreamManager({
    range: "^2.7.0",
    repository: "JuliusBrussee/caveman",
    cacheRoot,
    fetchImpl: fakeFetch,
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

test("revalidates cache and checks upstream on every startup", async () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "opencode-caveman-cache-revalidate-"))
  const tarballs = new Map<string, Buffer>([["2.7.0", await packageTarball("2.7.0")]])
  let releaseCalls = 0
  const baseFetch = githubFetchFixture(tarballs, () => ["2.7.0"])
  const fakeFetch: typeof fetch = async (input, init) => {
    if (String(input).includes("/releases?")) releaseCalls++
    return baseFetch(input, init)
  }

  const manager = new UpstreamManager({
    range: "^2.7.0",
    repository: "JuliusBrussee/caveman",
    cacheRoot,
    fetchImpl: fakeFetch,
  })

  await manager.ensure(async () => undefined)
  assert.equal(releaseCalls, 1)

  await assert.rejects(
    manager.ensure(async () => {
      throw new Error("wrapper contract changed")
    }),
    /Cached Caveman 2\.7\.0 is incompatible.*adapter compatibility check failed.*wrapper contract changed/,
  )
  assert.equal(releaseCalls, 2, "startup must resolve upstream even when cache exists")
})

test("refuses silent replacement when an existing release tag moves", async () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "opencode-caveman-cache-tag-move-"))
  const tarballs = new Map<string, Buffer>([["2.7.0", await packageTarball("2.7.0")]])
  let moved = false
  const movedCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  const fakeFetch: typeof fetch = async (input, init) => {
    const fixture = githubFetchFixture(
      tarballs,
      () => ["2.7.0"],
      moved ? { "2.7.0": movedCommit } : {},
    )
    return fixture(input, init)
  }

  const manager = new UpstreamManager({
    range: "^2.7.0",
    repository: "JuliusBrussee/caveman",
    cacheRoot,
    fetchImpl: fakeFetch,
  })

  await manager.ensure(async () => undefined)
  moved = true
  const second = await manager.ensure(async () => undefined)

  assert.equal(second.version, "2.7.0")
  assert.equal(second.commit, commits["2.7.0"])
  assert.equal(second.stale, true)
  assert.match(second.warning ?? "", /release tag v2\.7\.0 moved/)
})
