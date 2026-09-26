import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { lt, maxSatisfying, satisfies, valid, validRange } from "semver"
import * as tar from "tar"
import { readJsonFile, writeJsonFile } from "./fs.ts"

const UPSTREAM_PACKAGE = "caveman-installer"
const GITHUB_API = "https://api.github.com"
const MAX_RELEASE_PAGES = 10
const RELEASES_PER_PAGE = 100
const MAX_TARBALL_BYTES = 128 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 256 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 20_000
const NETWORK_TIMEOUT_MS = 30_000

interface GitHubRelease {
  tag_name?: string
  draft?: boolean
  prerelease?: boolean
}

interface GitHubObjectRef {
  type?: string
  sha?: string
}

interface GitHubRefResponse {
  object?: GitHubObjectRef
}

interface GitHubTagResponse {
  object?: GitHubObjectRef
}

interface CacheState {
  range: string
  repository: string
  version: string
  tag: string
  commit: string
  checkedAt: string
  resolved: string
  archiveSha256?: string
}

export interface UpstreamInstall {
  range: string
  repository: string
  version: string
  tag: string
  commit: string
  root: string
  resolved: string
  archiveSha256?: string
  checkedAt: string
  updated: boolean
  stale: boolean
  warning?: string
}

export interface UpstreamManagerOptions {
  range: string
  repository: string
  cacheRoot: string
  githubToken?: string
  now?: () => Date
  fetchImpl?: typeof fetch
}

export type UpstreamValidator = (root: string, version: string) => Promise<void>

interface ResolvedRelease {
  version: string
  tag: string
  commit: string
  tarball: string
  resolved: string
}

interface InstalledRelease {
  root: string
  archiveSha256?: string
}

function parseRepository(repository: string): { owner: string; repo: string } {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository.trim())
  if (!match) throw new Error(`Invalid Caveman GitHub repository: ${repository}`)
  return { owner: match[1]!, repo: match[2]! }
}

function githubHeaders(token?: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "opencode-caveman",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchGitHubJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  token?: string,
): Promise<T> {
  const response = await fetchWithTimeout(fetchImpl, url, { headers: githubHeaders(token) })
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining")
    const suffix = remaining === "0" ? " (GitHub API rate limit exhausted)" : ""
    throw new Error(`Caveman GitHub lookup failed: HTTP ${response.status}${suffix}`)
  }
  return await response.json() as T
}

async function resolveTagCommit(
  repository: string,
  tag: string,
  fetchImpl: typeof fetch,
  token?: string,
): Promise<string> {
  const { owner, repo } = parseRepository(repository)
  const refUrl = `${GITHUB_API}/repos/${owner}/${repo}/git/ref/tags/${encodeURIComponent(tag)}`
  const ref = await fetchGitHubJson<GitHubRefResponse>(fetchImpl, refUrl, token)
  let object = ref.object

  for (let depth = 0; depth < 5 && object?.type === "tag"; depth++) {
    if (!object.sha || !/^[0-9a-f]{40,64}$/i.test(object.sha)) {
      throw new Error(`Caveman release ${tag} has invalid annotated-tag object`)
    }
    const tagUrl = `${GITHUB_API}/repos/${owner}/${repo}/git/tags/${object.sha}`
    const annotated = await fetchGitHubJson<GitHubTagResponse>(fetchImpl, tagUrl, token)
    object = annotated.object
  }

  if (object?.type !== "commit" || !object.sha || !/^[0-9a-f]{40,64}$/i.test(object.sha)) {
    throw new Error(`Caveman release ${tag} does not resolve to a commit`)
  }
  return object.sha.toLowerCase()
}

export async function resolveRelease(
  range: string,
  repository: string,
  fetchImpl: typeof fetch,
  githubToken?: string,
): Promise<ResolvedRelease> {
  if (validRange(range) === null) throw new Error(`Invalid Caveman semver range: ${range}`)
  const { owner, repo } = parseRepository(repository)

  const byVersion = new Map<string, string>()
  for (let page = 1; page <= MAX_RELEASE_PAGES; page++) {
    const url = `${GITHUB_API}/repos/${owner}/${repo}/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`
    const releases = await fetchGitHubJson<GitHubRelease[]>(fetchImpl, url, githubToken)
    if (!Array.isArray(releases)) throw new Error("Caveman GitHub releases response is invalid")

    for (const release of releases) {
      if (release.draft || release.prerelease || typeof release.tag_name !== "string") continue
      const version = valid(release.tag_name)
      if (version && !byVersion.has(version)) byVersion.set(version, release.tag_name)
    }
    if (releases.length < RELEASES_PER_PAGE) break
    if (page === MAX_RELEASE_PAGES) {
      throw new Error(`Caveman release scan exceeded ${MAX_RELEASE_PAGES * RELEASES_PER_PAGE} releases`)
    }
  }

  const version = maxSatisfying([...byVersion.keys()], range, { includePrerelease: false })
  if (version === null) throw new Error(`No Caveman GitHub release satisfies ${range}`)
  const tag = byVersion.get(version)!
  const commit = await resolveTagCommit(repository, tag, fetchImpl, githubToken)
  const tarball = `${GITHUB_API}/repos/${owner}/${repo}/tarball/${commit}`

  return {
    version,
    tag,
    commit,
    tarball,
    resolved: `github:${repository}@${tag}#${commit}`,
  }
}

async function downloadTarball(
  release: ResolvedRelease,
  fetchImpl: typeof fetch,
  githubToken?: string,
): Promise<{ buffer: Buffer; sha256: string }> {
  const response = await fetchWithTimeout(fetchImpl, release.tarball, {
    headers: githubHeaders(githubToken),
  })
  if (!response.ok) throw new Error(`Caveman source archive download failed: HTTP ${response.status}`)

  const declaredLength = Number(response.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TARBALL_BYTES) {
    throw new Error(`Caveman source archive exceeds ${MAX_TARBALL_BYTES} byte limit`)
  }

  const chunks: Buffer[] = []
  let total = 0
  if (response.body) {
    const reader = response.body.getReader()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (!value) continue
        total += value.byteLength
        if (total > MAX_TARBALL_BYTES) {
          await reader.cancel().catch(() => undefined)
          throw new Error(`Caveman source archive exceeds ${MAX_TARBALL_BYTES} byte limit`)
        }
        chunks.push(Buffer.from(value))
      }
    } finally {
      reader.releaseLock()
    }
  } else {
    const bytes = Buffer.from(await response.arrayBuffer())
    total = bytes.byteLength
    if (total > MAX_TARBALL_BYTES) {
      throw new Error(`Caveman source archive exceeds ${MAX_TARBALL_BYTES} byte limit`)
    }
    chunks.push(bytes)
  }

  const buffer = Buffer.concat(chunks, total)
  return {
    buffer,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  }
}

function validCachedRoot(root: string, version: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      name?: unknown
      version?: unknown
    }
    return pkg.name === UPSTREAM_PACKAGE && pkg.version === version
  } catch {
    return false
  }
}

function rejectUnsafeEntries(root: string): void {
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const metadata = lstatSync(path)
      if (metadata.isSymbolicLink()) {
        throw new Error(`Caveman package contains symbolic link: ${entry.name}`)
      }
      if (metadata.isDirectory()) {
        visit(path)
        continue
      }
      if (!metadata.isFile()) {
        throw new Error(`Caveman package contains unsupported filesystem entry: ${entry.name}`)
      }
    }
  }
  visit(root)
}

function versionRoot(versionsRoot: string, version: string, commit: string): string {
  return join(versionsRoot, `${version}-${commit}`)
}

async function installRelease(
  release: ResolvedRelease,
  versionsRoot: string,
  fetchImpl: typeof fetch,
  githubToken?: string,
): Promise<InstalledRelease> {
  const finalRoot = versionRoot(versionsRoot, release.version, release.commit)
  if (validCachedRoot(finalRoot, release.version)) return { root: finalRoot }

  mkdirSync(versionsRoot, { recursive: true })
  const tempRoot = mkdtempSync(join(versionsRoot, `.install-${release.version}-`))
  const archive = join(tempRoot, "source.tgz")
  const extracted = join(tempRoot, "package")
  mkdirSync(extracted, { recursive: true })

  try {
    const downloaded = await downloadTarball(release, fetchImpl, githubToken)
    writeFileSync(archive, downloaded.buffer, { mode: 0o600 })
    let extractedBytes = 0
    let archiveEntries = 0
    await tar.x({
      cwd: extracted,
      file: archive,
      strip: 1,
      strict: true,
      preservePaths: false,
      maxDecompressionRatio: 100,
      filter: (_path, entry) => {
        archiveEntries++
        if (archiveEntries > MAX_ARCHIVE_ENTRIES) {
          throw new Error(`Caveman archive exceeds ${MAX_ARCHIVE_ENTRIES} entry limit`)
        }
        if (entry.type === "SymbolicLink" || entry.type === "Link") {
          throw new Error("Caveman archive contains link entry")
        }
        extractedBytes += Number(entry.size ?? 0)
        if (extractedBytes > MAX_EXTRACTED_BYTES) {
          throw new Error(`Caveman archive exceeds ${MAX_EXTRACTED_BYTES} extracted byte limit`)
        }
        return true
      },
    })

    rejectUnsafeEntries(extracted)
    if (!validCachedRoot(extracted, release.version)) {
      throw new Error(`Downloaded Caveman package identity mismatch for ${release.version}`)
    }

    if (existsSync(finalRoot)) {
      if (validCachedRoot(finalRoot, release.version)) {
        return { root: finalRoot, archiveSha256: downloaded.sha256 }
      }
      rmSync(finalRoot, { recursive: true, force: true })
    }

    try {
      renameSync(extracted, finalRoot)
    } catch (error) {
      // Another OpenCode process can win installation race for same immutable commit.
      if (validCachedRoot(finalRoot, release.version)) {
        return { root: finalRoot, archiveSha256: downloaded.sha256 }
      }
      throw error
    }
    return { root: finalRoot, archiveSha256: downloaded.sha256 }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

export class UpstreamManager {
  private readonly statePath: string
  private readonly versionsRoot: string
  private readonly now: () => Date
  private readonly fetchImpl: typeof fetch
  private inFlight?: Promise<UpstreamInstall>

  constructor(private readonly options: UpstreamManagerOptions) {
    parseRepository(options.repository)
    this.statePath = join(options.cacheRoot, "state.json")
    this.versionsRoot = join(options.cacheRoot, "versions")
    this.now = options.now ?? (() => new Date())
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  ensure(validate?: UpstreamValidator): Promise<UpstreamInstall> {
    if (this.inFlight) return this.inFlight
    const operation = this.ensureInternal(validate).finally(() => {
      if (this.inFlight === operation) this.inFlight = undefined
    })
    this.inFlight = operation
    return operation
  }

  private cached(state: CacheState | undefined): { root: string; state: CacheState } | undefined {
    if (!state) return undefined
    if (state.range !== this.options.range || state.repository !== this.options.repository) return undefined
    if (!satisfies(state.version, this.options.range, { includePrerelease: false })) return undefined
    if (!/^[0-9a-f]{40,64}$/i.test(state.commit)) return undefined
    const root = versionRoot(this.versionsRoot, state.version, state.commit)
    return validCachedRoot(root, state.version) ? { root, state } : undefined
  }


  private cachedInstall(
    cached: { root: string; state: CacheState },
    overrides: Partial<Pick<UpstreamInstall, "checkedAt" | "stale" | "warning">> = {},
  ): UpstreamInstall {
    return {
      range: this.options.range,
      repository: this.options.repository,
      version: cached.state.version,
      tag: cached.state.tag,
      commit: cached.state.commit,
      root: cached.root,
      resolved: cached.state.resolved,
      archiveSha256: cached.state.archiveSha256,
      checkedAt: overrides.checkedAt ?? cached.state.checkedAt,
      updated: false,
      stale: overrides.stale ?? false,
      warning: overrides.warning,
    }
  }

  private async ensureInternal(validate?: UpstreamValidator): Promise<UpstreamInstall> {
    mkdirSync(this.options.cacheRoot, { recursive: true })
    const previousState = readJsonFile<CacheState>(this.statePath)
    const rawCached = this.cached(previousState)
    let cached = rawCached
    let cachedValidationWarning: string | undefined

    // Wrapper upgrades can tighten adapter contract while cache state remains unchanged.
    // Revalidate before using cache as offline fallback.
    if (cached && validate) {
      try {
        await validate(cached.root, cached.state.version)
      } catch (error) {
        cachedValidationWarning = error instanceof Error
          ? `Cached Caveman ${cached.state.version} is incompatible: ${error.message}`
          : `Cached Caveman ${cached.state.version} is incompatible`
        cached = undefined
      }
    }


    try {
      const release = await resolveRelease(
        this.options.range,
        this.options.repository,
        this.fetchImpl,
        this.options.githubToken,
      )
      const checkedAt = this.now().toISOString()

      // Release tags are expected to be immutable. Same semantic version moving
      // to another commit is suspicious; keep known cache and surface warning.
      if (cached && release.version === cached.state.version && release.commit !== cached.state.commit) {
        throw new Error(
          `Caveman release tag ${release.tag} moved from ${cached.state.commit} to ${release.commit}; refusing silent replacement`,
        )
      }

      // Never downgrade compatible cache because remote release listing became incomplete.
      if (cached && lt(release.version, cached.state.version)) {
        const state: CacheState = { ...cached.state, checkedAt }
        writeJsonFile(this.statePath, state)
        return this.cachedInstall({ root: cached.root, state }, {
          checkedAt,
          warning: `GitHub resolved older Caveman ${release.version}; keeping cached ${cached.state.version}`,
        })
      }

      const installed = await installRelease(
        release,
        this.versionsRoot,
        this.fetchImpl,
        this.options.githubToken,
      )
      if (validate) {
        try {
          await validate(installed.root, release.version)
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown compatibility error"
          throw new Error(`Caveman ${release.version} adapter compatibility check failed: ${message}`)
        }
      }

      const state: CacheState = {
        range: this.options.range,
        repository: this.options.repository,
        version: release.version,
        tag: release.tag,
        commit: release.commit,
        checkedAt,
        resolved: release.resolved,
        ...(installed.archiveSha256
          ? { archiveSha256: installed.archiveSha256 }
          : cached?.state.commit === release.commit && cached.state.archiveSha256
            ? { archiveSha256: cached.state.archiveSha256 }
            : {}),
      }
      writeJsonFile(this.statePath, state)
      return {
        range: this.options.range,
        repository: this.options.repository,
        version: release.version,
        tag: release.tag,
        commit: release.commit,
        root: installed.root,
        resolved: release.resolved,
        archiveSha256: state.archiveSha256,
        checkedAt,
        updated: cached?.state.version !== release.version || cached?.state.commit !== release.commit,
        stale: false,
      }
    } catch (error) {
      if (!cached) {
        if (cachedValidationWarning) {
          const updateMessage = error instanceof Error ? error.message : "Caveman update check failed"
          throw new Error(`${cachedValidationWarning}; ${updateMessage}`)
        }
        throw error
      }
      return this.cachedInstall(cached, {
        stale: true,
        warning: error instanceof Error ? error.message : "Caveman update check failed",
      })
    }
  }
}
