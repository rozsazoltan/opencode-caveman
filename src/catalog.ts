import { existsSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { parse as parseYaml } from "yaml"

export type UpstreamHandler = (...args: any[]) => Promise<void> | void
export type UpstreamHandlers = Record<string, UpstreamHandler>

export interface UpstreamSkill {
  id: string
  name: string
  description: string
  location: string
  content: string
}

export interface UpstreamCommand {
  name: string
  description?: string
  template: string
  location: string
}

export interface UpstreamCatalog {
  version: string
  root: string
  handlers: UpstreamHandlers
  coreRules: string
  skills: UpstreamSkill[]
  commands: UpstreamCommand[]
  agentFiles: string[]
}

interface MarkdownDocument {
  attributes: Record<string, unknown>
  body: string
}

interface OpenCodePayloadList {
  skills: string[]
  commands: string[]
  agents: string[]
}

export function parseFrontmatter(content: string): MarkdownDocument {
  if (!content.startsWith("---\n")) return { attributes: {}, body: content }
  const end = content.indexOf("\n---", 4)
  if (end < 0) return { attributes: {}, body: content }
  const raw = content.slice(4, end)
  const bodyStart = end + 4
  const attributes = parseYaml(raw)
  return {
    attributes: attributes && typeof attributes === "object" ? attributes as Record<string, unknown> : {},
    body: content.slice(bodyStart).replace(/^\r?\n/, ""),
  }
}

function stringAttribute(attributes: Record<string, unknown>, name: string): string | undefined {
  const value = attributes[name]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

export function parseInstallerArray(source: string, constant: string): string[] {
  const escaped = constant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = new RegExp(`const\\s+${escaped}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source)
  if (!match) throw new Error(`Caveman installer does not define ${constant}`)

  const values = [...match[1]!.matchAll(/(['"])(.*?)\1/g)].map((entry) => entry[2]!)
  if (values.length === 0) throw new Error(`Caveman installer defines empty ${constant}`)
  return values
}

function safePayloadName(value: string, kind: "directory" | "markdown"): boolean {
  if (value.length === 0 || value === "." || value === ".." || basename(value) !== value) return false
  return kind === "directory"
    ? /^[A-Za-z0-9._-]+$/.test(value)
    : /^[A-Za-z0-9._-]+\.md$/.test(value)
}

function validatePayloadNames(values: string[], label: string, kind: "directory" | "markdown"): string[] {
  for (const value of values) {
    if (!safePayloadName(value, kind)) {
      throw new Error(`Caveman installer contains unsafe ${label} entry: ${value}`)
    }
  }
  return values
}

function loadPayloadList(root: string): OpenCodePayloadList {
  const installerPath = join(root, "bin", "install.js")
  if (!existsSync(installerPath)) throw new Error("Caveman package does not contain bin/install.js")
  const source = readFileSync(installerPath, "utf8")
  return {
    skills: validatePayloadNames(parseInstallerArray(source, "OPENCODE_SKILL_DIRS"), "skill", "directory"),
    commands: validatePayloadNames(parseInstallerArray(source, "OPENCODE_COMMAND_FILES"), "command", "markdown"),
    agents: validatePayloadNames(parseInstallerArray(source, "OPENCODE_AGENT_FILES"), "agent", "markdown"),
  }
}

function loadSkills(root: string, names: readonly string[]): UpstreamSkill[] {
  const skills: UpstreamSkill[] = []
  for (const directoryName of names) {
    const location = join(root, "skills", directoryName, "SKILL.md")
    if (!existsSync(location)) {
      throw new Error(`Caveman OpenCode skill is missing: ${directoryName}`)
    }
    const raw = readFileSync(location, "utf8")
    const document = parseFrontmatter(raw)
    const name = stringAttribute(document.attributes, "name") ?? directoryName
    skills.push({
      id: name,
      name,
      description: stringAttribute(document.attributes, "description") ?? `Caveman skill: ${name}`,
      location,
      content: document.body,
    })
  }
  return skills
}

function loadCommands(root: string, names: readonly string[]): UpstreamCommand[] {
  const commands: UpstreamCommand[] = []
  for (const fileName of names) {
    const location = join(root, "src", "plugins", "opencode", "commands", fileName)
    if (!existsSync(location)) {
      throw new Error(`Caveman OpenCode command is missing: ${fileName}`)
    }
    const raw = readFileSync(location, "utf8")
    const document = parseFrontmatter(raw)
    commands.push({
      name: basename(fileName, ".md"),
      description: stringAttribute(document.attributes, "description"),
      template: document.body,
      location,
    })
  }
  return commands
}

function loadCoreRules(root: string): string {
  const path = join(root, "src", "rules", "caveman-activate.md")
  if (!existsSync(path)) throw new Error("Caveman package does not contain src/rules/caveman-activate.md")
  const rules = readFileSync(path, "utf8").trim()
  if (!rules) throw new Error("Caveman OpenCode core ruleset is empty")
  return rules
}

async function loadHandlers(root: string, version: string): Promise<UpstreamHandlers> {
  const pluginPath = join(root, "src", "plugins", "opencode", "plugin.js")
  if (!existsSync(pluginPath)) {
    throw new Error(`Caveman ${version} does not contain src/plugins/opencode/plugin.js`)
  }

  const moduleUrl = `${pathToFileURL(pluginPath).href}?opencode-caveman=${encodeURIComponent(version)}`
  const loaded = await import(moduleUrl) as {
    default?: (ctx: unknown) => Promise<UpstreamHandlers> | UpstreamHandlers
    CavemanPlugin?: (ctx: unknown) => Promise<UpstreamHandlers> | UpstreamHandlers
  }
  const factory = loaded.default ?? loaded.CavemanPlugin
  if (typeof factory !== "function") {
    throw new Error(`Caveman ${version} OpenCode plugin has unsupported export shape`)
  }

  const handlers = await factory({})
  if (!handlers || typeof handlers !== "object") {
    throw new Error(`Caveman ${version} OpenCode plugin returned no handlers`)
  }
  return handlers
}

export function renderCommand(template: string, argumentsText: string): string {
  return template.replaceAll("$ARGUMENTS", argumentsText.trim())
}

export async function loadCatalog(root: string, version: string): Promise<UpstreamCatalog> {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    name?: unknown
    version?: unknown
  }
  if (pkg.name !== "caveman-installer" || pkg.version !== version) {
    throw new Error(`Caveman cache package mismatch: expected ${version}`)
  }

  const payload = loadPayloadList(root)
  return {
    version,
    root,
    handlers: await loadHandlers(root, version),
    coreRules: loadCoreRules(root),
    skills: loadSkills(root, payload.skills),
    commands: loadCommands(root, payload.commands),
    agentFiles: payload.agents,
  }
}
