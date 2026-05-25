// Native Pi slash commands for the Librarian session lifecycle.
//
// These implement the canonical /lib:session contract (docs/slash-commands.md)
// as real Pi commands: each handler calls the orchestrator directly (deterministic
// code, no LLM round-trip). Memory tools (recall/remember/…) are exposed to the
// model separately via mcp.json — commands cover the SESSION surface.

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Orchestrator } from "./orchestrator.js";
import type { ParsedSession } from "./session-client.js";

export interface CommandDeps {
  /** Refresh the footer status indicator after a lifecycle change. */
  refreshStatus?: (ctx: ExtensionCommandContext) => void;
}

interface ParsedArgs {
  positional: string;
  flags: Set<string>;
}

function parseArgs(args: string): ParsedArgs {
  const flags = new Set<string>();
  const rest: string[] = [];
  for (const token of args.trim().split(/\s+/).filter(Boolean)) {
    if (token.startsWith("--")) flags.add(token.slice(2));
    else rest.push(token);
  }
  return { positional: rest.join(" "), flags };
}

function describe(session: ParsedSession, index?: number): string {
  const n = index === undefined ? "" : `${index + 1}. `;
  const title = session.title ?? "(untitled)";
  const project = session.project_key ? ` — ${session.project_key}` : "";
  return `${n}[${session.status}] ${title}${project}\n   ${session.id}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerCommands(
  pi: ExtensionAPI,
  getOrchestrator: (cwd: string) => Orchestrator,
  deps: CommandDeps = {},
): void {
  const refresh = (ctx: ExtensionCommandContext): void => deps.refreshStatus?.(ctx);

  // Cache the last list so `/lib-session-resume <number>` can map a positional
  // number to a canonical id within this process (numbers are agent-side scratch).
  let lastList: ParsedSession[] = [];

  pi.registerCommand("lib-session-start", {
    description: "Start a new Librarian session [title] [--private]",
    handler: async (args, ctx) => {
      const { positional, flags } = parseArgs(args);
      try {
        const session = await getOrchestrator(ctx.cwd).startExplicit({
          ...(positional ? { title: positional } : {}),
          private: flags.has("private"),
        });
        ctx.ui.notify(
          `Librarian session started: ${session.id}${flags.has("private") ? " (private)" : ""}`,
          "info",
        );
        refresh(ctx);
      } catch (err) {
        ctx.ui.notify(`Could not start session: ${errorMessage(err)}`, "error");
      }
    },
  });

  pi.registerCommand("lib-session-list", {
    description: "List resumable Librarian sessions [--include-ended]",
    handler: async (args, ctx) => {
      const { flags } = parseArgs(args);
      try {
        lastList = await getOrchestrator(ctx.cwd).list(flags.has("include-ended"));
        if (lastList.length === 0) {
          ctx.ui.notify("No resumable sessions.", "info");
          return;
        }
        const body = lastList.map((s, i) => describe(s, i)).join("\n");
        pi.sendMessage({
          customType: "librarian",
          content: `Resumable sessions:\n${body}`,
          display: true,
        });
      } catch (err) {
        ctx.ui.notify(`Could not list sessions: ${errorMessage(err)}`, "error");
      }
    },
  });

  pi.registerCommand("lib-session-resume", {
    description: "Resume a Librarian session [<number|session_id>]",
    handler: async (args, ctx) => {
      const { positional } = parseArgs(args);
      const orchestrator = getOrchestrator(ctx.cwd);
      try {
        let sessionId: string | undefined;
        if (!positional) {
          // Inline list-and-select.
          lastList = await orchestrator.list(false);
          if (lastList.length === 0) {
            ctx.ui.notify("No resumable sessions.", "info");
            return;
          }
          const labels = lastList.map((s) => describe(s));
          const choice = await ctx.ui.select("Resume which session?", labels);
          if (choice === undefined) return; // cancelled
          sessionId = lastList[labels.indexOf(choice)]?.id;
        } else if (/^\d+$/.test(positional)) {
          const idx = Number(positional) - 1;
          sessionId = lastList[idx]?.id;
          if (!sessionId) {
            ctx.ui.notify(`No session numbered ${positional}; run /lib-session-list first.`, "error");
            return;
          }
        } else {
          sessionId = positional;
        }
        if (!sessionId) return;
        const handover = await orchestrator.resume(sessionId);
        ctx.ui.notify(`Resumed session: ${sessionId}`, "info");
        pi.sendMessage({ customType: "librarian", content: handover, display: true });
        refresh(ctx);
      } catch (err) {
        ctx.ui.notify(`Could not resume session: ${errorMessage(err)}`, "error");
      }
    },
  });

  pi.registerCommand("lib-session-checkpoint", {
    description: "Checkpoint the active Librarian session [summary]",
    handler: async (args, ctx) => {
      const { positional } = parseArgs(args);
      try {
        const outcome = await getOrchestrator(ctx.cwd).checkpointExplicit(positional);
        if (outcome.action === "no-session") {
          ctx.ui.notify("No active session to checkpoint.", "warning");
        } else {
          ctx.ui.notify("Session checkpointed.", "info");
        }
      } catch (err) {
        ctx.ui.notify(`Could not checkpoint: ${errorMessage(err)}`, "error");
      }
    },
  });

  pi.registerCommand("lib-session-pause", {
    description: "Pause the active Librarian session [summary]",
    handler: async (args, ctx) => {
      const { positional } = parseArgs(args);
      try {
        const action = await getOrchestrator(ctx.cwd).pauseExplicit(positional);
        if (action === "no-session") ctx.ui.notify("No active session to pause.", "warning");
        else if (action === "paused") ctx.ui.notify("Session paused.", "info");
        else ctx.ui.notify(`Pause: ${action}`, "warning");
        refresh(ctx);
      } catch (err) {
        ctx.ui.notify(`Could not pause: ${errorMessage(err)}`, "error");
      }
    },
  });

  pi.registerCommand("lib-session-end", {
    description: "End the active Librarian session [summary]",
    handler: async (args, ctx) => {
      const { positional } = parseArgs(args);
      try {
        await getOrchestrator(ctx.cwd).endExplicit(positional || undefined);
        ctx.ui.notify("Session ended.", "info");
        refresh(ctx);
      } catch (err) {
        ctx.ui.notify(`Could not end session: ${errorMessage(err)}`, "error");
      }
    },
  });

  pi.registerCommand("lib-session-search", {
    description: "Search Librarian sessions by event content <query>",
    handler: async (args, ctx) => {
      const query = args.trim();
      if (!query) {
        ctx.ui.notify("Usage: /lib-session-search <query>", "warning");
        return;
      }
      try {
        const result = await getOrchestrator(ctx.cwd).search(query);
        pi.sendMessage({ customType: "librarian", content: result, display: true });
      } catch (err) {
        ctx.ui.notify(`Search failed: ${errorMessage(err)}`, "error");
      }
    },
  });

  pi.registerCommand("lib-toggle-private", {
    description: "Toggle Librarian off-record (private) mode",
    handler: async (_args, ctx) => {
      try {
        const outcome = await getOrchestrator(ctx.cwd).toggle();
        if (outcome.privacy === "private") {
          ctx.ui.notify("Off-record: Librarian recording paused.", "info");
        } else {
          ctx.ui.notify("On-record: Librarian recording resumed.", "info");
        }
        refresh(ctx);
      } catch (err) {
        ctx.ui.notify(`Could not toggle privacy: ${errorMessage(err)}`, "error");
      }
    },
  });
}
