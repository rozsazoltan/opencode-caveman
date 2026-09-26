import type { Plugin } from "@opencode/plugin"
import { renderCommand, type UpstreamCatalog } from "./catalog.ts"
import type { UpstreamInstall } from "./upstream.ts"
import type { AgentSyncResult } from "./agents.ts"

export type PluginContext = Parameters<NonNullable<Parameters<typeof Plugin.define>[0]["setup"]>>[0]

export interface RuntimeSnapshot {
  install: UpstreamInstall
  catalog: UpstreamCatalog
  agents: AgentSyncResult
  refreshedAt: string
}

export interface RuntimeBridgeOptions {
  getSnapshot: () => RuntimeSnapshot
  refresh: () => Promise<RuntimeSnapshot>
  cleanAgents: () => Promise<AgentSyncResult>
  pluginVersion: string
  diagnostic?: (message: string) => void
}

async function callHandler(
  catalog: UpstreamCatalog,
  name: string,
  ...args: unknown[]
): Promise<void> {
  const handler = catalog.handlers[name]
  if (typeof handler !== "function") return
  await handler(...args)
}

function appendSystemText(event: { system: Array<any> }, text: string): void {
  if (!event.system.some((part) => part?.type === "text" && part.text === text)) {
    event.system.push({ type: "text", text })
  }
}

async function bridgeSystemHook(catalog: UpstreamCatalog, event: { system: Array<any> }): Promise<void> {
  appendSystemText(event, catalog.coreRules)

  const textIndexes: number[] = []
  const system: string[] = []

  for (let index = 0; index < event.system.length; index++) {
    const part = event.system[index]
    if (part?.type === "text" && typeof part.text === "string") {
      textIndexes.push(index)
      system.push(part.text)
    }
  }

  await callHandler(catalog, "experimental.chat.system.transform", {}, { system })

  const shared = Math.min(textIndexes.length, system.length)
  for (let index = 0; index < shared; index++) {
    const target = event.system[textIndexes[index]!]!
    target.text = system[index]!
  }
  for (let index = shared; index < system.length; index++) {
    event.system.push({ type: "text", text: system[index]! })
  }
}

function statusText(snapshot: RuntimeSnapshot, pluginVersion: string): string {
  const warning = snapshot.install.warning ? `\nWarning: ${snapshot.install.warning}` : ""
  const skipped = snapshot.agents.skipped.length > 0
    ? `\nAgent sync skipped: ${snapshot.agents.skipped.join("; ")}`
    : ""
  return [
    `OpenCode Caveman plugin: ${pluginVersion}`,
    `Upstream source: ${snapshot.install.repository}`,
    `Upstream range: ${snapshot.install.range}`,
    `Upstream version: ${snapshot.install.version} (${snapshot.install.tag})`,
    `Upstream commit: ${snapshot.install.commit.slice(0, 12)}`,
    `Last GitHub check: ${snapshot.install.checkedAt}`,
    `Using stale cache: ${snapshot.install.stale ? "yes" : "no"}`,
    `Core rules: loaded`,
    `Skills: ${snapshot.catalog.skills.length}`,
    `Commands: ${snapshot.catalog.commands.length}`,
    `Agents synced: ${snapshot.agents.installed}`,
  ].join("\n") + warning + skipped
}

function sameLocation(ctx: PluginContext, event: any): boolean {
  return event?.location?.directory === ctx.location.directory &&
    event?.location?.workspaceID === ctx.location.workspaceID
}

export async function installRuntimeBridge(
  ctx: PluginContext,
  options: RuntimeBridgeOptions,
): Promise<() => Promise<void>> {
  const registrations: Array<{ dispose(): Promise<void> }> = []
  const controller = new AbortController()

  registrations.push(await ctx.skill.transform((editor) => {
    for (const skill of options.getSnapshot().catalog.skills) {
      editor.add({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        location: skill.location,
        content: skill.content,
      })
    }
  }))

  registrations.push(await ctx.command.transform((editor) => {
    for (const command of options.getSnapshot().catalog.commands) {
      editor.add({
        name: command.name,
        ...(command.description ? { description: command.description } : {}),
        execute: async ({ sessionID, prompt, delivery }) => {
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            text: renderCommand(command.template, prompt.text),
            delivery,
          })
        },
      })
    }

    editor.add({
      name: "caveman-upstream-status",
      description: "Show OpenCode Caveman and resolved upstream versions",
      execute: async ({ sessionID }) => {
        await ctx.session.prompt({
          sessionID,
          text: statusText(options.getSnapshot(), options.pluginVersion),
          resume: false,
        })
      },
    })

    editor.add({
      name: "caveman-upstream-update",
      description: "Force upstream Caveman version check and refresh",
      execute: async ({ sessionID }) => {
        const snapshot = await options.refresh()
        await ctx.session.prompt({
          sessionID,
          text: statusText(snapshot, options.pluginVersion),
          resume: false,
        })
      },
    })

    editor.add({
      name: "caveman-managed-clean",
      description: "Remove Caveman agent files managed by this plugin",
      execute: async ({ sessionID }) => {
        const result = await options.cleanAgents()
        await ctx.session.prompt({
          sessionID,
          text: `Managed Caveman agents removed: ${result.removed}. Skipped: ${result.skipped.length}.`,
          resume: false,
        })
      },
    })
  }))

  registrations.push(await ctx.session.hook("prompt", async (event) => {
    const snapshot = options.getSnapshot()
    await callHandler(snapshot.catalog, "chat.message", {}, {
      parts: [{ type: "text", text: event.prompt.text }],
    })
  }))

  registrations.push(await ctx.session.hook("context", async (event) => {
    await bridgeSystemHook(options.getSnapshot().catalog, event)
  }))

  // Upstream installer writes Tier-3 rules to AGENTS.md. Inject same upstream
  // bytes into compaction requests without mutating user AGENTS.md.
  registrations.push(await ctx.session.hook("compaction", async (event) => {
    appendSystemText(event, options.getSnapshot().catalog.coreRules)
  }))

  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (!sameLocation(ctx, event)) continue
        await callHandler(options.getSnapshot().catalog, "event", { event })
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        options.diagnostic?.(error instanceof Error ? error.message : "Caveman event bridge failed")
      }
    }
  })()

  return async () => {
    controller.abort()
    let failure: unknown
    for (const registration of registrations.reverse()) {
      try {
        await registration.dispose()
      } catch (error) {
        if (failure === undefined) failure = error
      }
    }
    if (failure !== undefined) throw failure
  }
}
